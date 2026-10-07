import { untrack } from "svelte";
import type { GeometryIRV1, ProjectConfigV1 } from "@topostack/core";
import { addGraphicToSession, canPlace, draftProject, graphicPlaceableId, hiddenMarkingPrefixes, placeableFor, placementPatch, type PlaceableId, type PlacementSession } from "$lib/studio/placement/placeables";
import { placementMarginMm } from "$lib/studio/placement/viewport";
import type { PlacementPhase, PreviewMode } from "$lib/studio/studio-context";

/** What placement mode reads from, and asks of, the studio. */
export interface PlacementHost {
  project(): ProjectConfigV1;
  geometry(): GeometryIRV1;
  mode(): PreviewMode;
  threeUnavailable(): boolean;
  /** Starts loading the placement stage component. */
  loadStage(): void;
  updateFabrication(patch: Partial<ProjectConfigV1>): Promise<void>;
  setStatus(message: string): void;
}

const EXIT_MS = 220;
const SETTLE_LIMIT_MS = 4_000;
const FADE_MS = 400;

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Placement mode: an uncommitted project patch moved on a top-down view of the
 * piece. Done applies it as one edit, which generation bakes into the sheets;
 * see docs/placement.md. Construct during component setup: it watches whether
 * anything is left to place.
 */
export class PlacementController {
  session = $state<PlacementSession | undefined>();
  /** "settling" holds the drafts on screen until Done's regeneration lands; "closing" crossfades them into the generated markings while the view is still top-down, so they line up, before the 3D camera eases back. */
  phase = $state<PlacementPhase>("editing");
  /** Set briefly when entering or leaving swaps the view under the layer, so the new one fades in. */
  fade = $state(false);
  readonly backdrop: "3d" | "flat" | undefined = $derived.by(() => this.session ? (this.#host.project().outputMode === "stack" && !this.#host.threeUnavailable() ? "3d" : "flat") : undefined);
  readonly marginMm = $derived.by(() => placementMarginMm(this.#host.geometry().widthMm, this.#host.geometry().heightMm));
  readonly hiddenPrefixes = $derived.by(() => this.session ? hiddenMarkingPrefixes(this.#host.project()) : []);
  readonly #host: PlacementHost;
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(host: PlacementHost) {
    this.#host = host;
    // Turning every placeable off, with no graphic left to add, leaves nothing to place.
    $effect(() => {
      const session = this.session;
      if (session && !canPlace(draftProject(this.#host.project(), session))) untrack(() => this.cancel());
    });
  }

  start(id: PlaceableId): void {
    const project = this.#host.project();
    if (this.session) {
      // A second Move button while placing only switches the selection.
      if (this.phase === "editing" && placeableFor(id).available(draftProject(project, this.session))) this.session = { ...this.session, selected: id };
      return;
    }
    if (!placeableFor(id).available(project)) return;
    this.#open({ selected: id, draft: {} });
  }

  /** Adds a use of an uploaded graphic to the piece as a draft, opening placement mode on it. */
  placeGraphic(graphicId: string): void {
    if (this.session && this.phase !== "editing") return;
    const next = addGraphicToSession(this.#host.project(), this.session, graphicId, crypto.randomUUID());
    if (!next) { this.#host.setStatus("The piece already holds as many graphics as it can. Remove one before adding another."); return; }
    if (this.session) this.session = next;
    else this.#open(next);
  }

  /** Opens placement on the first placed graphic, or places the first uploaded one. */
  placeGraphics(): void {
    const project = this.#host.project();
    const first = project.placedGraphics?.find((placed) => placeableFor(graphicPlaceableId(placed.id)).available(project));
    if (first) this.start(graphicPlaceableId(first.id));
    else if (project.customGraphics?.[0]) this.placeGraphic(project.customGraphics[0].id);
  }

  commit(): void {
    if (!this.session || this.phase !== "editing") return;
    if (!Object.keys(this.session.draft).length) { this.#close(); return; }
    const committingSession = this.session;
    this.phase = "settling";
    const settled = this.#host.updateFabrication(placementPatch(this.#host.project(), $state.snapshot(this.session.draft))).catch(() => undefined);
    void Promise.race([settled, new Promise((resolve) => this.#later(resolve, SETTLE_LIMIT_MS))]).then(() => { if (this.session === committingSession) this.#close(); });
  }

  cancel(): void {
    if (this.session && this.phase === "editing") this.#close();
  }

  /** Leaves placement at once, without the exit animation: a new project replaced the one being placed on. */
  abandon(): void {
    this.session = undefined;
  }

  dispose(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  #open(session: PlacementSession): void {
    this.session = session;
    this.phase = "editing";
    this.#host.loadStage();
    this.#pulseFade();
  }

  #close(): void {
    const closingSession = this.session;
    this.phase = "closing";
    this.#later(() => {
      if (this.session !== closingSession) return;
      this.#pulseFade();
      this.session = undefined;
      this.phase = "editing";
    }, reducedMotion() ? 0 : EXIT_MS);
  }

  #pulseFade(): void {
    if (this.backdrop !== "3d" || this.#host.mode() === "3d" || reducedMotion()) return;
    this.fade = true;
    this.#later(() => { this.fade = false; }, FADE_MS);
  }

  #later(run: (value?: unknown) => void, delayMs: number): void {
    const timer = setTimeout(() => { this.#timers.delete(timer); run(); }, delayMs);
    this.#timers.add(timer);
  }
}
