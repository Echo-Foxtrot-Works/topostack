import { isMercatorBoundsTuple } from "./geo-bounds.ts";

/**
 * Who may be served a registered source. "development" keeps a source off
 * production and Atomm builds and the production Worker, for data whose
 * licence still waits on an approval (docs/terrain-selection.md).
 */
export const SOURCE_AVAILABILITY = ["all", "development"] as const;
export type SourceAvailability = typeof SOURCE_AVAILABILITY[number];

/** A publisher's permission a source needs before it may reach every visitor. */
export interface SourceApproval {
  required: true;
  /** The approval number once granted; required before availability "all". */
  reference?: string;
}

/** Contract shared by the browser, gateway, and offline survey provisioning. */
export interface SurveySource {
  id: string;
  name: string;
  url: string;
  license: string;
  bounds: [number, number, number, number];
  encoding: "depth-terrarium-v1" | "elevation-terrarium-v1";
  maxZoom: number;
  availability: SourceAvailability;
  approval?: SourceApproval;
}

/** True when an environment's visitors may be served `source`. Unknown environments see only "all". */
export function sourceAvailableIn(source: Pick<SurveySource, "availability">, environment: string | undefined): boolean {
  return source.availability === "all" || environment === "development";
}

function approvalValue(id: string, value: unknown, availability: SourceAvailability): SourceApproval | undefined {
  if (value === undefined) return undefined;
  const approval = value as Record<string, unknown> | null;
  if (!approval || typeof approval !== "object" || approval.required !== true ||
      (approval.reference !== undefined && (typeof approval.reference !== "string" || !approval.reference.trim()))) {
    throw new Error(`Invalid source approval: ${id}`);
  }
  if (availability === "all" && approval.reference === undefined) throw new Error(`Source needs an approval reference before it is available to all: ${id}`);
  return { required: true, ...(approval.reference === undefined ? {} : { reference: approval.reference as string }) };
}

/** Fail at startup/build time rather than silently selecting the wrong decoder. */
export function validateSurveyCatalog(value: unknown): { sources: SurveySource[] } {
  if (!value || typeof value !== "object" || !("sources" in value) || !Array.isArray(value.sources)) {
    throw new Error("Survey catalog must contain a sources array.");
  }
  const ids = new Set<string>();
  const sources = value.sources.map((item: unknown): SurveySource => {
    if (!item || typeof item !== "object") throw new Error("Invalid survey source.");
    const source = item as Record<string, unknown>;
    const text = (field: string): string => {
      const value = source[field];
      if (typeof value !== "string" || !value.trim()) throw new Error(`Survey source requires ${field}.`);
      return value;
    };
    const id = text("id");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate survey ID: ${id}`);
    ids.add(id);
    const url = text("url");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`Invalid source URL: ${id}`);
    const bounds = source.bounds;
    if (!isMercatorBoundsTuple(bounds)) throw new Error(`Invalid survey bounds: ${id}`);
    const encoding = source.encoding;
    if (encoding !== "depth-terrarium-v1" && encoding !== "elevation-terrarium-v1") throw new Error(`Unsupported survey encoding: ${id}`);
    const maxZoom = source.maxZoom;
    if (typeof maxZoom !== "number" || !Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 15) throw new Error(`Invalid survey maxZoom: ${id}`);
    const availability = source.availability ?? "all";
    if (!SOURCE_AVAILABILITY.includes(availability as SourceAvailability)) throw new Error(`Invalid source availability: ${id}`);
    const approval = approvalValue(id, source.approval, availability as SourceAvailability);
    return { id, name: text("name"), url, license: text("license"), bounds: [...bounds], encoding, maxZoom, availability: availability as SourceAvailability, ...(approval ? { approval } : {}) };
  });
  return { sources };
}

/**
 * Height systems a terrain archive may carry. All are orthometric heights in
 * metres near mean sea level; their offsets (under a metre) are far below what
 * a laser-cut layer resolves, so they mix without transformation:
 * CGVD2013 (Canada), JP-TP (Japan's Tokyo Peil heights, JGD2011 and the April
 * 2025 JGD2024 revision alike) and MSL (GEBCO's ocean depths).
 */
export const TERRAIN_VERTICAL_DATUMS = ["CGVD2013", "JP-TP", "MSL"] as const;
export const TERRAIN_SOURCE_KINDS = ["lidar-dtm", "national-dtm", "bathymetry-grid"] as const;

/** Valid samples per kind: land models stay in land range; ocean grids reach the deepest trench. */
export function terrainValueRange(kind: TerrainSource["kind"]): readonly [number, number] {
  return kind === "bathymetry-grid" ? [-11000, 10] : [-500, 9000];
}

export interface TerrainSource extends SurveySource {
  minZoom: number;
  verticalDatum: typeof TERRAIN_VERTICAL_DATUMS[number];
  /** "bathymetry-grid" sources only fill ocean the base terrain already has below sea level. */
  kind: typeof TERRAIN_SOURCE_KINDS[number];
  priority: number;
  nativeResolutionM: number;
  acquisitionYear?: number;
}

/** Terrain archives share the numeric PNG contract, but never encode depths. */
export function validateTerrainCatalog(value: unknown): { sources: TerrainSource[] } {
  const validated = validateSurveyCatalog(value);
  const raw = (value as { sources: Record<string, unknown>[] }).sources;
  return { sources: validated.sources.map((source, index) => {
    const item = raw[index]!;
    if (source.encoding !== "elevation-terrarium-v1" || !(TERRAIN_VERTICAL_DATUMS as readonly unknown[]).includes(item.verticalDatum) ||
        typeof item.minZoom !== "number" || !Number.isInteger(item.minZoom) || item.minZoom < 0 || item.minZoom > source.maxZoom ||
        !(TERRAIN_SOURCE_KINDS as readonly unknown[]).includes(item.kind) ||
        typeof item.priority !== "number" || !Number.isInteger(item.priority) || item.priority < 1 || item.priority > 1000 ||
        typeof item.nativeResolutionM !== "number" || !Number.isFinite(item.nativeResolutionM) || item.nativeResolutionM <= 0 || item.nativeResolutionM > 1000 ||
        (item.acquisitionYear !== undefined && (typeof item.acquisitionYear !== "number" || !Number.isInteger(item.acquisitionYear) || item.acquisitionYear < 1900 || item.acquisitionYear > 2100))) {
      throw new Error(`Invalid terrain source: ${source.id}`);
    }
    return { ...source, minZoom: item.minZoom, verticalDatum: item.verticalDatum as TerrainSource["verticalDatum"], kind: item.kind as TerrainSource["kind"], priority: item.priority, nativeResolutionM: item.nativeResolutionM, ...(item.acquisitionYear === undefined ? {} : { acquisitionYear: item.acquisitionYear as number }) };
  }) };
}

/** Explicit quality priority; registry order can never change terrain selection. */
export function rankTerrainSources(sources: readonly TerrainSource[]): TerrainSource[] {
  return [...sources].sort((a, b) => b.priority - a.priority || a.nativeResolutionM - b.nativeResolutionM || (b.acquisitionYear ?? 0) - (a.acquisitionYear ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** PMTiles stores bounds at 1e-7 degree precision; allow rounding, not new coverage. */
export function validateTerrainArchiveBounds(actual: unknown, expected: readonly number[]): void {
  if (!Array.isArray(actual) || actual.length !== 4 || actual.some((value: unknown, index: number) =>
    typeof value !== "number" || !Number.isFinite(value) || Math.abs(value - expected[index]!) > 1e-6)) {
    throw new Error("Terrain archive extent does not match registration.");
  }
}
