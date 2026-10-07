import { getContext, setContext } from "svelte";
import type { SheetNesting } from "$lib/studio/sheet-nesting.svelte";
import type { GeoPoint, GeometryIRV1, LineStyleV1, OperationPath, ProjectConfigV1, SourceBundleV1, TerrainStackPlan, UserDepthChartRefV1 } from "@topostack/core";
import type { elevationUnit, lengthUnit, planSeamGrid } from "@topostack/core";
import type { UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";
import type { PlaceResult } from "$lib/domain/data-provider";
import type { studioFeedbackContext } from "$lib/site/feedback";
import type { ExportPhase } from "$lib/studio/export-notice";
import type { HistoryAvailability } from "$lib/studio/history";
import type { LazyComponent } from "$lib/studio/lazy-component";
import type { PlaceableId, PlacementSession } from "$lib/studio/placement/placeables";
import type { ConfigSectionId, countDetailMarkings, modeledLakes, visibleWarnings } from "$lib/studio/preview-summary";

/** Editing, waiting for Done's regeneration, or fading out. */
export type PlacementPhase = "editing" | "settling" | "closing";
export type PreviewMode = "map" | "engraving" | "2d" | "3d" | "custom" | "export";
export type GenerateState = "idle" | "loading" | "ready" | "error";
export type LineWidthKey = Exclude<keyof LineStyleV1, "trailPattern" | "roadStyle" | "roadCap">;

/**
 * Everything the studio panels read from, and write back to, App.svelte.
 *
 * App.svelte owns the state (project, geometry, generation lifecycle, dialog
 * flags) and the functions that mutate it. The panels under studio/panels/
 * get this object from context and read its properties inside `$derived`, so
 * they re-render when App's state changes without holding any state of their
 * own. Writable members are the flags a panel toggles directly (open dialogs,
 * preview mode, the selected layer); everything else changes through a method.
 */
export interface StudioContext {
  // Project and generated output
  readonly project: ProjectConfigV1;
  readonly sourceProject: ProjectConfigV1;
  readonly activeSource: SourceBundleV1;
  readonly geometry: GeometryIRV1;
  readonly outputMode: ProjectConfigV1["outputMode"];
  readonly stackPlan: TerrainStackPlan;
  readonly stackLayerCount: number;
  readonly contourInterval: number;
  readonly seamGrid: ReturnType<typeof planSeamGrid>;
  readonly seamSummary: string;
  readonly northArrowSizeLimitMm: number;
  readonly activeLinePreset: string | undefined;
  readonly detailCounts: ReturnType<typeof countDetailMarkings>;
  readonly modeledLakes: ReturnType<typeof modeledLakes>;
  readonly hasDepthOverride: boolean;
  readonly layerTicks: number[];
  readonly terrainDataStale: boolean;
  readonly verticalExaggerationStale: boolean;
  readonly terrainDataAction: "regenerate" | "generate" | "load";
  readonly lakeDepthFittingOn: boolean;
  readonly visibleWarnings: ReturnType<typeof visibleWarnings>;

  // Generation and export lifecycle
  readonly generationState: GenerateState;
  readonly generationStep: number;
  readonly status: string;
  readonly detailsUpdating: boolean;
  /** True while a refresh fetches terrain for a moved map area. */
  readonly terrainRefreshing: boolean;
  readonly previewBusy: boolean;
  readonly previewBusyLabel: string;
  readonly exportPhase: ExportPhase;
  readonly exportBlockedBy: string | undefined;
  readonly exportReady: boolean;
  /** Sheet nesting for the export: search progress, the layout found, and whether to use it. */
  readonly sheetNesting: SheetNesting;
  /** Layout of the acrylic water inserts on their own stock sheets. */
  readonly acrylicSheetNesting: SheetNesting;
  /** Layer, panel and height counts (or contour count) for the preview readout. */
  readonly outputSummary: readonly string[];
  readonly booted: boolean;
  readonly historyAvailability: HistoryAvailability;
  readonly embeddedInPlatform: boolean;

  // Preview
  mode: PreviewMode;
  threeUnavailable: boolean;
  previewNotice: string;
  selectedLayer: number;
  explodedDrag: number | undefined;
  readonly explodedPreview: number;
  readonly previewModeOptions: ReadonlyArray<{ value: string; label: string }>;
  readonly MapCanvas: typeof import("$lib/studio/MapCanvas.svelte").default | undefined;
  readonly EngravingPreview: typeof import("$lib/studio/EngravingPreview.svelte").default | undefined;
  readonly TwoDPreview: typeof import("$lib/studio/TwoDPreview.svelte").default | undefined;
  readonly ThreePreview: typeof import("$lib/studio/ThreePreview.svelte").default | undefined;
  readonly engravingPreview: LazyComponent<typeof import("$lib/studio/EngravingPreview.svelte").default>;
  readonly twoDPreview: LazyComponent<typeof import("$lib/studio/TwoDPreview.svelte").default>;
  readonly PlacementStage: typeof import("$lib/studio/placement/PlacementStage.svelte").default | undefined;
  readonly CustomDataView: typeof import("$lib/studio/customdata/CustomDataView.svelte").default | undefined;
  readonly customDataView: LazyComponent<typeof import("$lib/studio/customdata/CustomDataView.svelte").default>;
  readonly mapCanvas: LazyComponent<typeof import("$lib/studio/MapCanvas.svelte").default>;
  readonly ExportPreview: typeof import("$lib/studio/ExportPreview.svelte").default | undefined;
  readonly exportPreview: LazyComponent<typeof import("$lib/studio/ExportPreview.svelte").default>;

  // Placement mode
  /** The open placement session, or undefined outside placement mode. */
  placement: PlacementSession | undefined;
  /** Which view placement mode draws over: the studio's 3D preview, or the flat top-down composite. */
  readonly placementBackdrop: "3d" | "flat" | undefined;
  readonly placementPhase: PlacementPhase;
  /** True for a moment after placement swaps the view underneath, so it fades in. */
  readonly placementFade: boolean;
  readonly placementMargin: number;
  readonly placementHiddenPrefixes: readonly string[];
  startPlacement(id: PlaceableId): void;
  /** Adds a use of an uploaded graphic as a placement draft, opening placement mode when it is closed. */
  placeGraphic(graphicId: string): void;
  /** Opens placement mode for graphics: on the first placed one, or placing the first uploaded one. */
  placeGraphics(): void;
  commitPlacement(): void;
  cancelPlacement(): void;

  // Sidebar and dialogs
  readonly openSections: Record<ConfigSectionId, boolean>;
  searchOpen: boolean;
  resetOpen: boolean;
  mapAspectLocked: boolean;
  placingMarker: boolean;
  /** The path being drawn by clicking the map, before it joins the project. */
  readonly lineDraft: { points: GeoPoint[] } | undefined;
  lineworkOpen: boolean;
  locationTrigger: HTMLButtonElement | undefined;

  // Display units
  readonly shownLengthUnit: ReturnType<typeof lengthUnit>;
  readonly shownElevationUnit: ReturnType<typeof elevationUnit>;
  shownLength(valueMm: number): number;
  shownDepth(valueM: number): number;
  shownLineWidth(valueMm: number): number;
  shownTextSize(valueMm: number): number;
  storedLength(value: number): number;
  workAreaLength(value: number): number;

  // Edits
  updateProject(patch: Partial<ProjectConfigV1>): void;
  updateFabrication(patch: Partial<ProjectConfigV1>, delayMs?: number): Promise<void>;
  updateMapDetails(patch: Partial<ProjectConfigV1>, delayMs?: number): Promise<void>;
  updateLocation(patch: Partial<ProjectConfigV1["location"]>): void;
  updateVerticalExaggeration(verticalExaggeration: number): void;
  updateDepthLayerLimit(value: number): void;
  setLakeDepth(hylakId: number, shown: number): Promise<void> | undefined;
  setLineWidth(key: LineWidthKey, shown: number): Promise<void> | undefined;
  applyCustomDataEdit(patch: Partial<ProjectConfigV1> | undefined): void;
  /** Names a marker or path. It records an undo step and leaves the preview alone. */
  renameCustomData(patch: Partial<ProjectConfigV1> | undefined): void;
  /** Arms drawing a path on the map; the next clicks are its points. */
  startLineDraft(): void;
  extendLineDraft(point: GeoPoint): void;
  /** Adds the drawn path as one edit. Closed, it is a boundary; open, a trail. */
  commitLineDraft(closed?: boolean): void;
  cancelLineDraft(): void;
  /**
   * Keeps a traced chart in this browser's library. It changes no project:
   * tracing a chart and carving a lake with it are separate acts.
   */
  saveChartToLibrary(record: UserChartBathymetryV1): Promise<UserDepthChartRefV1>;
  /** Carves this lake from a saved chart, and marks the terrain for regeneration. */
  useChartForLake(lakeKey: string, reference: UserDepthChartRefV1): Promise<void>;
  /** Stops using a lake's chart; the chart stays in the library. */
  clearDepthChart(lakeKey: string): Promise<void>;
  choosePlace(place: PlaceResult): void;
  undo(): void;
  redo(): void;
  importProject(file: File | undefined): Promise<void>;
  copyShareLink(): Promise<void>;
  /** Opens the system share sheet with the design's link, or copies it where there is none. */
  shareDesign(): Promise<void>;
  /** Adds markers and paths from a GPX, KML or GeoJSON file as one undo step. */
  importCustomData(file: File | undefined): Promise<void>;
  /** Adds an SVG as a marker icon, and gives it to `markerId` when one is named. */
  importMarkerIcon(file: File | undefined, markerId?: string): Promise<void>;
  /** Adds an SVG to the project's graphics library. */
  importGraphic(file: File | undefined): Promise<void>;

  // Generation
  generate(): Promise<void>;
  cancelGeneration(): void;

  // Sidebar helpers
  toggleSection(section: ConfigSectionId): void;
  setAllSections(open: boolean): void;
  sectionSummary(section: ConfigSectionId): string;
  navigateChoice(event: KeyboardEvent & { currentTarget: HTMLButtonElement }): void;
  dismissPreviewWarning(event: MouseEvent, warningKey?: string): void;
  previewMarkingPath(marking: OperationPath): string;
  trailPatternDash(style: LineStyleV1): string | undefined;
  getFeedbackContext(): ReturnType<typeof studioFeedbackContext>;
}

const KEY = Symbol("topostack-studio");

export function provideStudio(studio: StudioContext): void {
  setContext(KEY, studio);
}

export function getStudio(): StudioContext {
  const studio = getContext<StudioContext | undefined>(KEY);
  if (!studio) throw new Error("Studio panels must be rendered inside App.svelte.");
  return studio;
}
