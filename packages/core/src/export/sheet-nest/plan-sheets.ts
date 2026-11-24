import type { NestPartV1, NestPlacementV1, ResolvedSheetNestSettings, SheetNestPlanV1, SheetNestSheetV1 } from "../../types.js";
import type { StripEngine, StripEngineItem, StripEnginePlacement } from "./engine.js";
import { sheetNestJobKey } from "./job-key.js";
import { packRectangles } from "./rectangles.js";
import { allowedOrientations } from "./resolve.js";
import { PLACEMENT_TOLERANCE_MM, verifySheet } from "./verify.js";

export class SheetNestError extends Error {
  constructor(message: string, readonly code: "no-parts" | "oversize", readonly labels: string[] = []) {
    super(message);
    this.name = "SheetNestError";
  }
}

export interface PlanSheetsOptions {
  engine: StripEngine;
  /** Search time; defaults to the settings' time budget. */
  budgetMs?: number;
  /** Receives every improved plan: a complete, valid layout the maker could cut now. */
  onPlan?: (plan: SheetNestPlanV1) => void;
  /** Checked between packer calls; true stops the search and keeps the best plan so far. */
  shouldStop?: () => boolean;
  now?: () => number;
}

/** Target fill of a sheet, as a share of its usable area, tried from full to sparse. */
const FILL_LADDER = [0.85, 0.72, 0.6, 0.45, 0.3];
/** Remaining parts below this share of one sheet are tried on a single sheet directly. */
const LAST_SHEET_FILL = 0.9;
const PROBE_MS = { min: 300, max: 20_000 };
/** Share of the budget spent filling sheets; the rest merges and compacts the last ones. */
const FILL_SHARE = 0.8;

type Sheet = SheetNestSheetV1;

/**
 * Lays every part out on as few stock sheets as the time budget allows.
 *
 * sparrow only packs a single strip of fixed height, as short as possible.
 * Sheets are filled one at a time. The planner picks the parts for a sheet
 * (largest first, up to a target share of its area) and asks the engine to
 * fit them into a strip as tall as the sheet and no longer than it. It lowers
 * the target until a probe fits, then commits that sheet and moves on. A
 * bounding-box layout of everything is emitted first, and whichever plan uses
 * fewer sheets wins, so the result is never worse than that fallback.
 */
export async function planSheets(parts: NestPartV1[], settings: ResolvedSheetNestSettings, options: PlanSheetsOptions): Promise<SheetNestPlanV1> {
  const now = options.now ?? (() => performance.now());
  const start = now();
  const deadline = start + (options.budgetMs ?? settings.timeBudgetS * 1000);
  const { engine } = options;
  if (parts.length === 0) throw new SheetNestError("There are no parts to nest.", "no-parts");

  const margin = settings.marginMm;
  const spacing = settings.spacingMm;
  const usableWidth = settings.sheetWidthMm - 2 * margin;
  const usableHeight = settings.sheetHeightMm - 2 * margin;
  const usableArea = usableWidth * usableHeight;
  const orientations = allowedOrientations(settings.rotation);
  const partsById = new Map(parts.map((part) => [part.id, part]));
  const items: StripEngineItem[] = parts.map((part) => ({
    outline: part.outline.slice(0, -1).map((point) => [point.x, point.y] as [number, number]),
    ...(orientations ? { orientationsDeg: orientations } : {}),
  }));
  const area = (indexes: number[]) => indexes.reduce((sum, index) => sum + parts[index]!.areaMm2, 0);

  const toSheet = (indexes: number[], placements: StripEnginePlacement[], stripWidth: number, method: Sheet["method"]): Sheet => ({
    placements: placements.map((placement): NestPlacementV1 => ({
      partId: parts[indexes[placement.index]!]!.id,
      rotationDeg: placement.rotationDeg,
      xMm: placement.x + margin,
      yMm: placement.y + margin,
    })),
    usedWidthMm: Math.min(settings.sheetWidthMm, stripWidth + 2 * margin),
    method,
  });

  /** Bounding-box sheets for the given parts, filled in order. */
  const rectangleSheets = (indexes: number[]): Sheet[] => {
    const sheets: Sheet[] = [];
    let remaining = indexes;
    while (remaining.length) {
      const packed = packRectangles(remaining.map((index) => items[index]!), usableHeight, spacing, usableWidth);
      // A fresh empty skyline tries every remaining part and allowed orientation.
      // Reporting its failures here keeps the size check and packing tolerances identical.
      if (!packed.placements.length) {
        const labels = [...remaining].sort((a, b) => a - b).map((index) => parts[index]!.label);
        throw new SheetNestError(
          `${labels.join(", ")} ${labels.length === 1 ? "is" : "are"} larger than the usable ${format(usableWidth)} × ${format(usableHeight)} mm sheet. Use a larger sheet, or set a machine work area so the model is split into pieces that fit.`,
          "oversize",
          labels,
        );
      }
      sheets.push(toSheet(remaining, packed.placements, packed.stripWidth, "rectangles"));
      remaining = packed.unplaced.map((position) => remaining[position]!);
    }
    return sheets;
  };

  const plan = (sheets: Sheet[], final: boolean): SheetNestPlanV1 => ({
    schemaVersion: 1,
    jobKey,
    engine: { name: engine.name, ...engine.info },
    settings,
    sheets,
    final,
    utilization: area(parts.map((_, index) => index)) / (sheets.length * settings.sheetWidthMm * settings.sheetHeightMm),
    elapsedMs: Math.round(now() - start),
  });

  const jobKey = sheetNestJobKey(parts, settings);
  const byAreaDescending = parts.map((_, index) => index).sort((left, right) => parts[right]!.areaMm2 - parts[left]!.areaMm2 || left - right);
  const baseline = rectangleSheets(byAreaDescending);
  options.onPlan?.(plan(baseline, engine.name === "rectangles"));
  if (engine.name === "rectangles") return plan(baseline, true);

  let probes = 0;
  const stopping = () => now() >= deadline || (options.shouldStop?.() ?? false);
  const probe = async (indexes: number[], timeLimitMs: number, targetWidth: number | undefined): Promise<Sheet | undefined> => {
    probes += 1;
    try {
      const result = await engine.pack({
        items: indexes.map((index) => items[index]!),
        stripHeight: usableHeight,
        spacing,
        timeLimitMs: Math.max(1, Math.round(timeLimitMs)),
        ...(targetWidth === undefined ? {} : { targetWidth }),
        seed: (Math.imul(settings.seed + 1, 1_000_003) + probes) >>> 0,
      });
      if (result.stripWidth > usableWidth + PLACEMENT_TOLERANCE_MM || result.placements.length !== indexes.length) return undefined;
      const sheet = toSheet(indexes, result.placements, result.stripWidth, "sparrow");
      // Never trust a layout that fails the independent check.
      return verifySheet(partsById, sheet.placements, settings).length ? undefined : sheet;
    } catch {
      return undefined;
    }
  };
  const probeTime = (remaining: number[]) => {
    const sheetsLeft = Math.max(1, Math.ceil(area(remaining) / (0.75 * usableArea)));
    const fillTimeLeft = start + (deadline - start) * FILL_SHARE - now();
    return Math.min(PROBE_MS.max, Math.max(PROBE_MS.min, fillTimeLeft / (3 * sheetsLeft)));
  };
  /** Largest remaining part plus, largest first, every part that still fits the area budget. */
  const select = (remaining: number[], budget: number) => {
    const chosen = [remaining[0]!];
    let total = parts[remaining[0]!]!.areaMm2;
    for (const index of remaining.slice(1)) {
      if (total + parts[index]!.areaMm2 <= budget) {
        chosen.push(index);
        total += parts[index]!.areaMm2;
      }
    }
    return chosen;
  };

  const committed: Array<{ indexes: number[]; sheet: Sheet }> = [];
  let remaining = byAreaDescending;
  const emitDraft = () => options.onPlan?.(plan([...committed.map((entry) => entry.sheet), ...rectangleSheets(remaining).map((sheet) => ({ ...sheet, provisional: true }))], false));

  while (remaining.length && !stopping()) {
    const time = probeTime(remaining);
    let accepted: { indexes: number[]; sheet: Sheet } | undefined;
    if (area(remaining) <= LAST_SHEET_FILL * usableArea) {
      const sheet = await probe(remaining, time, usableWidth);
      if (sheet) accepted = { indexes: remaining, sheet };
    }
    let failedFill = 1;
    for (const fill of FILL_LADDER) {
      if (accepted || stopping()) break;
      const indexes = select(remaining, fill * usableArea);
      const sheet = await probe(indexes, time, usableWidth);
      if (sheet) accepted = { indexes, sheet };
      else failedFill = fill;
    }
    // Top up: try the midpoint between the fill that fitted and the one that did not.
    if (accepted && accepted.indexes !== remaining && !stopping()) {
      const fitted = area(accepted.indexes) / usableArea;
      const indexes = select(remaining, ((fitted + failedFill) / 2) * usableArea);
      if (indexes.length > accepted.indexes.length) {
        const sheet = await probe(indexes, time, usableWidth);
        if (sheet) accepted = { indexes, sheet };
      }
    }
    if (!accepted) {
      if (stopping()) break;
      // Nothing packed: the largest part goes on a sheet of its own.
      const alone = [remaining[0]!];
      accepted = { indexes: alone, sheet: rectangleSheets(alone)[0]! };
    }
    const taken = new Set(accepted.indexes);
    committed.push(accepted);
    remaining = remaining.filter((index) => !taken.has(index));
    if (remaining.length) emitDraft();
  }
  // Out of time: whatever is left goes on bounding-box sheets.
  const tail = rectangleSheets(remaining);

  // With time to spare, try to empty the last sheet into the one before it,
  // then shorten the last sheet so its offcut is as large as possible.
  if (!tail.length && committed.length >= 2 && !stopping()) {
    const last = committed.at(-1)!;
    const previous = committed.at(-2)!;
    const indexes = [...previous.indexes, ...last.indexes];
    const merged = area(indexes) <= usableArea ? await probe(indexes, Math.min(PROBE_MS.max, deadline - now()), usableWidth) : undefined;
    if (merged) committed.splice(-2, 2, { indexes, sheet: merged });
  }
  if (!tail.length && committed.length && !stopping()) {
    const last = committed.at(-1)!;
    const compacted = await probe(last.indexes, Math.min(PROBE_MS.max, deadline - now()), undefined);
    if (compacted && compacted.usedWidthMm < last.sheet.usedWidthMm) committed[committed.length - 1] = { indexes: last.indexes, sheet: compacted };
  }

  const packed = [...committed.map((entry) => entry.sheet), ...tail];
  const packedIsBetter = packed.length < baseline.length || (packed.length === baseline.length && (packed.at(-1)?.usedWidthMm ?? 0) <= (baseline.at(-1)?.usedWidthMm ?? 0));
  return plan(packedIsBetter ? packed : baseline, true);
}

const format = (value: number) => Number(value.toFixed(1)).toString();
