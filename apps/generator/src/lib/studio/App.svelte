<script lang="ts">
  import { onDestroy, onMount, untrack, setContext } from "svelte";
  import { base } from "$app/paths";
  import { Download } from "@lucide/svelte";
  import { AppShell, Brand, Button, ContextBar, Sidebar, Topbar, Workspace } from "@loidolt/theme-svelte";
  import { sourceRequirements, DEFAULT_PROJECT, planSeamGrid, displayElevation, displayLength, elevationUnit, generateGeometry, labelPathData, lengthUnit, MAX_PROJECT_NAME_LENGTH, millimetersFromDisplay, planTerrainStack, projectFingerprint, validateProject, type GeometryIRV1, type LineStyleV1, type OperationPath, type ProjectConfigV1, type SourceBundleV1 } from "@topostack/core";
  import { assembleWater, boundsForProject, loadLakeAreas, loadSurveyedLakeDepths, loadTerrain, loadVectorMarkings, searchPlaces, type PlaceResult } from "$lib/domain/data-provider";
  import { applySurveyProvenance } from "$lib/domain/bathymetry";
  import { resolveLakeOutlines } from "$lib/domain/lake-outlines";
  import { dataZoom } from "$lib/domain/tile-math";
  import { CustomDataActions } from "$lib/studio/customdata/custom-data-actions.svelte";
  import { theme } from "$lib/site/theme";
  import { trackUsage } from "$lib/site/usage";
  import { createSamplePreviewSource } from "$lib/domain/sample-preview";
  import { exportBlockReason, parseProject } from "@topostack/core";
  import { loadProject, saveProject, saveProjectUnloadCopy } from "$lib/storage/storage";
  import { AutomaticNesting } from "$lib/atomm/automatic-nesting";
  import { connectAtomm } from "$lib/atomm/atomm-bridge";
  import type { ModelContextLike } from "$lib/studio/webmcp";
  import type { WebMcpHost } from "$lib/studio/webmcp-tools";
  import type { DownloadOption } from "$lib/studio/native-export";
  import { downloadProject as downloadWithNotice, ExportNotice } from "$lib/studio/export-notice";
  import { SheetNesting } from "$lib/studio/sheet-nesting.svelte";
  import { studioFeedbackContext } from "$lib/site/feedback";
  import ExportDialog from "$lib/studio/ExportDialog.svelte";
  import SheetLayoutSection from "$lib/studio/panels/SheetLayoutSection.svelte";
  import ResetProjectDialog from "$lib/studio/ResetProjectDialog.svelte";
  import { readAtommLocale } from "$lib/atomm/atomm-locale";
  import { ProjectHistory } from "$lib/studio/history";
  import { historyShortcut } from "$lib/studio/history-keys";
  import { ATOMM_ENGRAVING_MODE_OPTIONS, ATOMM_STACK_MODE_OPTIONS, ENGRAVING_MODE_OPTIONS, PRESETS, STACK_MODE_OPTIONS } from "$lib/studio/options";
  import * as edits from "$lib/studio/project-edits";
  import { isAbortError, PreviewPipeline } from "$lib/studio/preview-pipeline";
  import { LazyComponent } from "$lib/studio/lazy-component";
  import { addGraphicToSession, canPlace, draftProject, graphicPlaceableId, hiddenMarkingPrefixes, placeableFor, placementPatch, type PlaceableId, type PlacementSession } from "$lib/studio/placement/placeables";
  import { placementMarginMm } from "$lib/studio/placement/viewport";
  import { createProjectPreviewSource } from "$lib/studio/project-preview";
  import { restoreStartupProject } from "$lib/studio/startup-restore";
  import { activeLinePreset as findActiveLinePreset, CONFIG_SECTION_IDS, countDetailMarkings, featuredLayerIndex, layerForEnabledDetail, modeledLakes as findModeledLakes, sectionSummary as summarizeSection, visibleWarnings as summarizeWarnings, type ConfigSectionId } from "$lib/studio/preview-summary";
  import { retryingLoader } from "$lib/studio/lazy-load";
  import { sameMapArea } from "$lib/studio/project-diff";
  import { pointsToPath } from "$lib/studio/svg-path";
  import { changedProjectKeys, projectPatch } from "$lib/studio/project-patch";
  import type { SourcePreparationCache } from "$lib/studio/source-refresh";
  import { generationStatus, generationToast, previewPendingStatus, previewUpdatedStatus, type PreviewUpdateKind } from "$lib/studio/status-messages";
  import { nav } from "$lib/studio/customdata/custom-data-nav.svelte";
  import { provideStudio, type PlacementPhase, type GenerateState, type LineWidthKey, type PreviewMode } from "$lib/studio/studio-context";
  import ProjectControls from "$lib/studio/panels/ProjectControls.svelte";
  import StudioMenu from "$lib/studio/panels/StudioMenu.svelte";
  import OutputSwitch from "$lib/studio/panels/OutputSwitch.svelte";
  import SetupSection from "$lib/studio/panels/SetupSection.svelte";
  import CustomDataSection from "$lib/studio/panels/CustomDataSection.svelte";
  import ParameterSections from "$lib/studio/panels/ParameterSections.svelte";
  import UnitSwitch from "$lib/studio/panels/UnitSwitch.svelte";
  import GenerationDock from "$lib/studio/panels/GenerationDock.svelte";
  import LayerDock from "$lib/studio/panels/LayerDock.svelte";
  import PreviewPanel from "$lib/studio/panels/PreviewPanel.svelte";

  let { initialPreview }: { initialPreview?: GeometryIRV1 } = $props();

  const MENU_STATE_KEY = "topostack-menu-sections-v1";
  const MAX_PROJECT_FILE_BYTES = 2_000_000;
  /** A project file carrying traced depth charts is mostly their depth grids. */
  const MAX_PROJECT_BUNDLE_BYTES = 24_000_000;
  function previewFor(config: ProjectConfigV1, source: SourceBundleV1): GeometryIRV1 {
    const result = generateGeometry(config, source);
    addPreviewWarning(result, source);
    return result;
  }

  function addPreviewWarning(result: GeometryIRV1, source: SourceBundleV1): void {
    if (source.sourceKind === "real" || result.warnings.some((warning) => warning.code === "DATA_FALLBACK")) return;
    result.warnings.push({ code: "DATA_FALLBACK", message: source.sourceKind === "preview" ? "Bundled real-data preview. Generate fresh terrain before exporting." : "Sample preview only. Generate real terrain before exporting." });
  }

  const defaultPreviewSource = createSamplePreviewSource();
  const defaultPreviewGeometry = untrack(() => initialPreview) ?? previewFor(DEFAULT_PROJECT, defaultPreviewSource);
  addPreviewWarning(defaultPreviewGeometry, defaultPreviewSource);
  let project = $state.raw<ProjectConfigV1>(DEFAULT_PROJECT);
  let activeSource = $state.raw<SourceBundleV1>(defaultPreviewSource);
  let sourceProject = $state.raw<ProjectConfigV1>(DEFAULT_PROJECT);
  let geometry = $state.raw<GeometryIRV1>(defaultPreviewGeometry);
  let mode = $state<PreviewMode>("3d");
  let threeUnavailable = $state(false);
  let previewNotice = $state("");
  let dismissedWarnings = $state<string[]>([]);
  let generationState = $state<GenerateState>("ready");
  let generationStep = $state(1);
  let status = $state("Real-data sample preview ready");
  let detailsUpdating = $state(false);
  // A refresh that fetches terrain for a moved map area, not just a restyle.
  let terrainRefreshing = $state(false);
  let selectedLayer = $state(featuredLayerIndex(defaultPreviewGeometry));
  // Live exploded-slider position. Committing every tick into `project`
  // replaced the whole config at 60 Hz, which re-ran the export fingerprint,
  // the stack plan, the map-area comparison and every sidebar summary; the
  // drag now only moves the preview and records one history entry on release.
  let explodedDrag = $state.raw<number | undefined>(undefined);
  let searchOpen = $state(false);
  let mapAspectLocked = $state(false);
  // Placing markers, drawing paths, names and depth charts: the maker's own data.
  const customData = new CustomDataActions({
    project: () => project,
    replaceProject: (next) => { project = next; },
    recordHistory: (from, keys) => projectHistory.record(from, keys),
    updateFabrication: (patch) => updateFabrication(patch),
    setStatus: (message) => { status = message; },
  });
  $effect(() => { customData.disarmOutside(mode, nav.section); });
  let locationTrigger: HTMLButtonElement;
  let lineworkOpen = $state(false);
  let menuStateReady = $state(false);
  let openSections = $state<Record<ConfigSectionId, boolean>>({
    setup: true,
    size: false,
    terrain: false,
    details: false,
    customData: false,
    linework: false,
    advanced: false,
  });
  let AtommWorkbench = $state.raw<typeof import("$lib/atomm/AtommWorkbench.svelte").default>();
  let atommLayoutFailed = $state(false);
  let atommReady = $state(false);
  let embeddedInPlatform = $state(false);
  setContext("atomm-embedded", () => embeddedInPlatform);
  let exportOpen = $state(false);
  let resetOpen = $state(false);
  const exportNotice = new ExportNotice((message) => { status = message; });
  const sheetNesting = new SheetNesting();
  const automaticNesting = new AutomaticNesting();
  setContext("atomm-nesting", automaticNesting);
  $effect(() => { if (embeddedInPlatform && previewBusy) automaticNesting.cancel(); });
  // A nested layout depends only on the geometry and the sheet settings, so
  // other edits (a rename, a style tweak) must not re-extract every part.
  // A string compares by value, so an unrelated edit leaves it unchanged.
  const nestSettingsKey = $derived(JSON.stringify([project.sheetNesting ?? null, project.workAreaWidthMm, project.workAreaHeightMm]));
  const usesSheetNesting = $derived(Boolean(project.sheetNesting));
  $effect(() => {
    // The Atomm embed does not offer sheet nesting or load its planner.
    if (embeddedInPlatform) return;
    const nestGeometry = geometry;
    void nestSettingsKey;
    const restore = usesSheetNesting && nestGeometry.sourceKind === "real";
    untrack(() => {
      void sheetNesting.refresh(nestGeometry, project);
      // A layout saved before a reload comes back once the same design is generated again.
      // Only projects that ever used sheet nesting pay for loading the planner.
      if (restore) void sheetNesting.restore(nestGeometry, project);
    });
  });
  const exportPhase = $derived(exportNotice.phase);
  const exportTitle = $derived(exportNotice.title);
  const exportDetail = $derived(exportNotice.detail);
  let themeColor = $state("");
  let booted = $state(false);
  let historyAvailability = $state({ canUndo: false, canRedo: false });
  const projectHistory = new ProjectHistory((availability) => { historyAvailability = availability; });
  // Worker lifecycle, edit revisions, and debounced refreshes. Every edit that
  // affects generation invalidates it, so stale work can never commit.
  const pipeline = new PreviewPipeline();
  // Map-data refresh code loads with the first preview edit, not at startup. A
  // failed load is forgotten, so the next edit retries it.
  const loadSourcePreparation = retryingLoader(async () => new (await import("$lib/studio/source-refresh")).SourcePreparationCache({ loadVectorMarkings, loadLakeAreas, loadSurveyedLakeDepths, applySurveyProvenance, resolveLakeOutlines, assembleWater, dataZoom }), "Map data refresh");
  let sourcePreparation: Promise<SourcePreparationCache> | undefined;
  const preparedSources = () => sourcePreparation = loadSourcePreparation();
  // Continuous controls (sliders, typed numbers) fire on every input tick. The
  // project value updates immediately; the preview refresh trails the last tick.
  const PREVIEW_REFRESH_DELAY_MS = 120;
  let generationAbort: AbortController | undefined;
  // Preview and modal components load on first use, keeping inactive workflows out of the initial bundle.
  const locationDialog = new LazyComponent(() => import("$lib/studio/LocationDialog.svelte"), (error) => {
    console.error("TopoStack could not load place search.", error); searchOpen = false; status = "Place search could not load · reload to update TopoStack";
  });
  const mapCanvas = new LazyComponent(() => import("$lib/studio/MapCanvas.svelte"), (error) => {
    console.error("TopoStack could not load the map preview.", error);
    if (mode === "map") { mode = project.outputMode === "engraving" ? "engraving" : "2d"; previewNotice = "Map preview could not load · reload to update TopoStack"; }
  });
  const engravingPreview = new LazyComponent(() => import("$lib/studio/EngravingPreview.svelte"), (error) => {
    console.error("TopoStack could not load the engraving preview.", error); status = "Engraving preview could not load · retry or reload to update TopoStack";
  });
  const twoDPreview = new LazyComponent(() => import("$lib/studio/TwoDPreview.svelte"), (error) => {
    console.error("TopoStack could not load the cut preview.", error); status = "Cut preview could not load · retry or reload to update TopoStack";
  });
  const threePreview = new LazyComponent(() => import("$lib/studio/ThreePreview.svelte"), (error) => {
    console.error("TopoStack could not load the 3D preview.", error);
    // Placement falls back to the flat top-down view on its own.
    if (placement) threeUnavailable = true;
    if (mode === "3d") { threeUnavailable = true; mode = "2d"; previewNotice = "3D preview could not load · reload to update TopoStack"; }
  });
  const exportPreview = new LazyComponent(() => import("$lib/studio/ExportPreview.svelte"), (error) => {
    console.error("TopoStack could not load the export preview.", error); status = "Export preview could not load · retry or reload to update TopoStack";
  });
  const placementStage = new LazyComponent(() => import("$lib/studio/placement/PlacementStage.svelte"), (error) => {
    console.error("TopoStack could not load placement mode.", error); placement = undefined; status = "Placement could not load · reload to update TopoStack";
  });
  const customDataView = new LazyComponent(() => import("$lib/studio/customdata/CustomDataView.svelte"), (error) => {
    console.error("TopoStack could not load the custom data view.", error);
    if (mode === "custom") { mode = project.outputMode === "engraving" ? "engraving" : threeUnavailable ? "2d" : "3d"; previewNotice = "Custom data could not load · reload to update TopoStack"; }
  });
  // The custom data sidebar carries every tool for tracing a chart, so it is
  // loaded with that view rather than waited for on the studio's first paint.
  const customDataNav = new LazyComponent(() => import("$lib/studio/customdata/CustomDataNav.svelte"), (error) => {
    console.error("TopoStack could not load the custom data controls.", error);
  });
  const LocationDialog = $derived(locationDialog.component);
  const CustomDataView = $derived(customDataView.component);
  const CustomDataNav = $derived(customDataNav.component);
  const MapCanvas = $derived(mapCanvas.component);
  const EngravingPreview = $derived(engravingPreview.component);
  const TwoDPreview = $derived(twoDPreview.component);
  const ThreePreview = $derived(threePreview.component);
  const PlacementStage = $derived(placementStage.component);
  const ExportPreview = $derived(exportPreview.component);

  // Placement mode: an uncommitted project patch moved on a top-down view of
  // the piece. Done applies it as one edit, which generation bakes into the
  // sheets; see docs/placement.md.
  let placement = $state<PlacementSession | undefined>();
  // "settling" holds the drafts on screen until Done's regeneration lands.
  // "closing" crossfades them into the generated markings while the view is
  // still top-down, so they line up; only then does the 3D camera ease back.
  let placementPhase = $state<PlacementPhase>("editing");
  // Set briefly when entering or leaving swaps the view under the layer, so the new one fades in.
  let placementFade = $state(false);
  const PLACEMENT_EXIT_MS = 220;
  const PLACEMENT_SETTLE_LIMIT_MS = 4_000;
  const placementBackdrop: "3d" | "flat" | undefined = $derived(placement ? (project.outputMode === "stack" && !threeUnavailable ? "3d" : "flat") : undefined);
  const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function pulsePlacementFade(): void {
    if (placementBackdrop !== "3d" || mode === "3d" || reducedMotion()) return;
    placementFade = true;
    setTimeout(() => { placementFade = false; }, 400);
  }
  const placementMargin = $derived(placementMarginMm(geometry.widthMm, geometry.heightMm));
  const placementHiddenPrefixes = $derived(placement ? hiddenMarkingPrefixes(project) : []);
  function startPlacement(id: PlaceableId): void {
    if (placement) {
      // A second Move button while placing only switches the selection.
      if (placementPhase === "editing" && placeableFor(id).available(draftProject(project, placement))) placement = { ...placement, selected: id };
      return;
    }
    if (!placeableFor(id).available(project)) return;
    openPlacement({ selected: id, draft: {} });
  }
  function openPlacement(session: PlacementSession): void {
    placement = session;
    placementPhase = "editing";
    placementStage.load();
    pulsePlacementFade();
  }
  /** Adds a use of an uploaded graphic to the piece as a draft, opening placement mode on it. */
  function placeGraphic(graphicId: string): void {
    if (placement && placementPhase !== "editing") return;
    const next = addGraphicToSession(project, placement, graphicId, crypto.randomUUID());
    if (!next) { status = "The piece already holds as many graphics as it can. Remove one before adding another."; return; }
    if (placement) placement = next;
    else openPlacement(next);
  }
  /** Opens placement on the first placed graphic, or places the first uploaded one. */
  function placeGraphics(): void {
    const first = project.placedGraphics?.find((placed) => placeableFor(graphicPlaceableId(placed.id)).available(project));
    if (first) startPlacement(graphicPlaceableId(first.id));
    else if (project.customGraphics?.[0]) placeGraphic(project.customGraphics[0].id);
  }
  function closePlacement(): void {
    const closingSession = placement;
    placementPhase = "closing";
    setTimeout(() => {
      if (placement !== closingSession) return;
      pulsePlacementFade();
      placement = undefined;
      placementPhase = "editing";
    }, reducedMotion() ? 0 : PLACEMENT_EXIT_MS);
  }
  function commitPlacement(): void {
    if (!placement || placementPhase !== "editing") return;
    if (!Object.keys(placement.draft).length) { closePlacement(); return; }
    const committingSession = placement;
    placementPhase = "settling";
    const settled = updateFabrication(placementPatch(project, $state.snapshot(placement.draft))).catch(() => undefined);
    void Promise.race([settled, new Promise((resolve) => setTimeout(resolve, PLACEMENT_SETTLE_LIMIT_MS))]).then(() => { if (placement === committingSession) closePlacement(); });
  }
  function cancelPlacement(): void {
    if (placement && placementPhase === "editing") closePlacement();
  }
  // Turning every placeable off, with no graphic left to add, leaves nothing to place.
  $effect(() => {
    if (placement && !canPlace(draftProject(project, placement))) untrack(cancelPlacement);
  });

  $effect(() => {
    const outputMode = project.outputMode;
    if (outputMode === "engraving" && mode !== "map" && mode !== "engraving" && mode !== "custom" && mode !== "export") mode = "engraving";
    else if (outputMode === "stack" && mode === "engraving") mode = threeUnavailable ? "2d" : "3d";
  });

  $effect(() => {
    void theme.resolved;
    themeColor = getComputedStyle(document.documentElement).getPropertyValue("--loidolt-background").trim();
  });

  // Opening place search, the map, or 3D again retries a failed load: their
  // failure handlers already moved away. The engraving and cut previews have
  // no fallback view, so they wait for the Retry button instead of looping.
  $effect(() => {
    if (searchOpen) locationDialog.load();
    if (mode === "custom") { customDataView.load(); customDataNav.load(); }
    // Markers, paths and imported files are placed on the same map as map view.
    if (mode === "map" || (mode === "custom" && nav.section !== "graphics")) mapCanvas.load();
    // Graphics are shown on the piece, in the view the output uses.
    else if (mode === "custom" && nav.section === "graphics") {
      if (project.outputMode === "engraving") engravingPreview.ensure();
      else if (threeUnavailable) twoDPreview.ensure();
      else threePreview.load();
    }
    else if (mode === "engraving") engravingPreview.ensure();
    else if (mode === "2d") twoDPreview.ensure();
    else if (mode === "3d") threePreview.load();
    else if (mode === "export") exportPreview.ensure();
    if (placementBackdrop === "3d") threePreview.load();
  });

  const explodedPreview = $derived(explodedDrag ?? project.explodedPreview);
  const totalHeight = $derived(geometry.layers.length * project.materialThicknessMm);
  // Layer count follows from map scale, relief, and material thickness, so the
  // panel previews the stack the current settings will actually produce.
  const stackPlan = $derived(planTerrainStack(project, geometry.landReliefM, geometry.bounds, geometry.waterDepthBelowLandM));
  // Sea-level alignment can add a sheet; report the generated count once current.
  const stackLayerCount = $derived(geometry.configFingerprint === projectFingerprint(project) ? geometry.layers.length : stackPlan.layerCount);
  const previewModeOptions = $derived(embeddedInPlatform
    ? project.outputMode === "engraving" ? ATOMM_ENGRAVING_MODE_OPTIONS : ATOMM_STACK_MODE_OPTIONS
    : project.outputMode === "engraving" ? ENGRAVING_MODE_OPTIONS : STACK_MODE_OPTIONS);
  const previewBusy = $derived(generationState === "loading" || detailsUpdating);
  const previewBusyLabel = $derived(generationState === "loading" ? "Building your terrain" : terrainRefreshing ? "Loading terrain for this area" : "Refreshing preview");
  const contourInterval = $derived(geometry.landReliefM / (project.engravingContourCount + 1));
  const fabricationPanelCount = $derived(sheetNesting.exportPlan?.sheets.length ?? geometry.layers.length - geometry.fabricationNests.length);
  const getFeedbackContext = () => studioFeedbackContext(project, activeSource, geometry, !sameMapArea(sourceProject, project));
  const terrainDataStale = $derived(!sameMapArea(sourceProject, project));
  const verticalExaggerationStale = $derived(project.outputMode === "stack" && sourceProject.verticalExaggeration !== project.verticalExaggeration);
  const terrainDataAction = $derived(embeddedInPlatform ? "load" : geometry.sourceKind === "real" ? "regenerate" : "generate");
  const exportBlockedBy = $derived(exportBlockReason(geometry, project));
  const exportReady = $derived(!exportBlockedBy);
  const exportStatusLabel = $derived(exportPhase === "preparing" ? "Preparing files" : exportPhase === "ready" ? "Export ready" : exportPhase === "error" ? "Export failed" : exportReady ? "Ready to export" : "Generate before export");
  const exportStatusTone = $derived(exportPhase === "error" ? "error" : exportPhase === "preparing" ? "busy" : exportReady ? "ready" : "blocked");
  const lakeDepthFittingOn = $derived(project.outputMode === "stack" && project.showWaterDepth && project.fitLakeDepth
    && geometry.waterSurfaces.some((surface) => surface.kind === "lake" && surface.depthFitScale !== undefined && surface.depthFitScale < 1));
  const visibleWarnings = $derived(summarizeWarnings(geometry.warnings, dismissedWarnings));

  function dismissPreviewWarning(event: MouseEvent, warningKey?: string): void {
    const button = event.currentTarget as HTMLButtonElement;
    // Keep keyboard focus in the preview after removing the focused control.
    const next = [...(button.closest(".warning-stack")?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
      .find((candidate) => candidate !== button);
    (next ?? document.querySelector<HTMLButtonElement>('.mode-switch [aria-checked="true"]'))?.focus({ preventScroll: true });
    if (warningKey) dismissedWarnings = [...dismissedWarnings, warningKey];
    else previewNotice = "";
  }

  const layerTicks = $derived(geometry.layers.map((layer) => Math.round(displayElevation(layer.elevationM, project.units))));
  const shownLengthUnit = $derived(lengthUnit(project.units));
  const outputSummary = $derived(project.outputMode === "engraving"
    ? [`${project.engravingContourCount} contours`, "No cut paths"]
    : [`${geometry.layers.length} layers`, `${fabricationPanelCount} cut panels`, `${shownLength(totalHeight)} ${shownLengthUnit} tall`]);
  const seamGrid = $derived(planSeamGrid(project));
  const seamSummary = $derived(seamGrid
    ? `${seamGrid.columns} × ${seamGrid.rows} sheets per layer · ${shownLength(seamGrid.pitchXMm)} × ${shownLength(seamGrid.pitchYMm)} ${shownLengthUnit} tiles`
    : project.workAreaWidthMm > 0 || project.workAreaHeightMm > 0
      ? "Fits the work area in one piece."
      : "Leave at 0 to cut the model in one piece.");
  const shownElevationUnit = $derived(elevationUnit(project.units));
  const northArrowSizeLimitMm = $derived(edits.northArrowMaximumMm(project.widthMm, project.heightMm));
  const activeLinePreset = $derived(findActiveLinePreset(project.lineStyle));
  // Renames and slider ticks replace `project` and `geometry` without touching
  // these, so the counts are only recomputed when the layers or mode change.
  const geometryLayers = $derived(geometry.layers);
  const outputMode = $derived(project.outputMode);
  const detailCounts = $derived(countDetailMarkings(geometryLayers, outputMode));
  const modeledLakes = $derived(findModeledLakes(geometry.waterSurfaces));
  const hasDepthOverride = $derived(Object.keys(project.waterDepthOverrides).length > 0);

  function shownDepth(valueM: number): number {
    return Math.round(displayElevation(valueM, project.units));
  }

  function setLakeDepth(hylakId: number, shown: number): Promise<void> | undefined {
    if (!Number.isFinite(shown) || shown <= 0) return undefined;
    const depthM = project.units === "imperial" ? shown / 3.280839895 : shown;
    return updateFabrication({ waterDepthOverrides: { ...project.waterDepthOverrides, [String(hylakId)]: depthM } });
  }

  function shownLength(valueMm: number): number {
    return Number(displayLength(valueMm, project.units).toFixed(3));
  }

  function storedLength(value: number): number {
    return millimetersFromDisplay(value, project.units);
  }

  /** 0 means "no limit on this axis", so it must survive unit conversion exactly. */
  function workAreaLength(value: number): number {
    return value > 0 ? millimetersFromDisplay(value, project.units) : 0;
  }

  function shownTextSize(valueMm: number): number {
    return Number(displayLength(valueMm, project.units).toFixed(project.units === "imperial" ? 4 : 1));
  }

  function shownLineWidth(valueMm: number): number {
    return Number(displayLength(valueMm, project.units).toFixed(project.units === "imperial" ? 4 : 2));
  }

  function setLineWidth(key: LineWidthKey, shown: number): Promise<void> | undefined {
    if (!Number.isFinite(shown)) return undefined;
    return updateFabrication({ lineStyle: { ...project.lineStyle, [key]: storedLength(shown) } });
  }

  const applyCustomDataEdit = (patch: Partial<ProjectConfigV1> | undefined) => customData.applyEdit(patch);

  function trailPatternDash(style: LineStyleV1): string | undefined {
    if (style.trailPattern === "solid") return undefined;
    return style.trailPattern === "dotted" ? "0.1 3.2" : "6 4";
  }

  function previewMarkingPath(marking: OperationPath): string {
    if (marking.label && marking.points[0]) return labelPathData(marking.label, marking.points[0], 0, 0, 0, marking.textStyle);
    return pointsToPath(marking.points);
  }

  function navigateChoice(event: KeyboardEvent & { currentTarget: HTMLButtonElement }): void {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    const choices = [...(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button[role="radio"]') ?? [])];
    const current = choices.indexOf(event.currentTarget);
    if (current < 0 || !choices.length) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (current + (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) + choices.length) % choices.length;
    choices[next]?.focus();
    choices[next]?.click();
  }

  function toggleSection(section: ConfigSectionId): void {
    openSections = { ...openSections, [section]: !openSections[section] };
  }

  /** Sidebar sections on screen: markers and paths live in the custom data view outside the Atomm embed. */
  const shownSections = $derived(embeddedInPlatform ? CONFIG_SECTION_IDS : CONFIG_SECTION_IDS.filter((section) => section !== "customData"));

  function setAllSections(open: boolean): void {
    openSections = { ...openSections, ...Object.fromEntries(shownSections.map((section) => [section, open])) };
  }

  function sectionSummary(section: ConfigSectionId): string {
    return summarizeSection(section, project, stackLayerCount);
  }

  onMount(() => {
    let cancelled = false;
    try {
      const savedMenuState: unknown = JSON.parse(localStorage.getItem(MENU_STATE_KEY) ?? "null");
      if (savedMenuState && typeof savedMenuState === "object") {
        openSections = Object.fromEntries(CONFIG_SECTION_IDS.map((section) => [section, typeof (savedMenuState as Record<string, unknown>)[section] === "boolean" ? (savedMenuState as Record<string, boolean>)[section] : openSections[section]])) as Record<ConfigSectionId, boolean>;
      }
    } catch {
      // A malformed preference should never prevent the editor from loading.
    }
    menuStateReady = true;
    embeddedInPlatform = window.parent !== window;
    if (embeddedInPlatform) void import("$lib/atomm/AtommWorkbench.svelte").then((module) => { if (!cancelled) AtommWorkbench = module.default; }).catch(() => { if (!cancelled) atommLayoutFailed = true; });
    const disconnectAtomm = connectAtomm(() => {
      if (!embeddedInPlatform) return { geometry, project, sheetPlan: sheetNesting.exportPlan };
      if (exportBlockedBy || previewBusy) throw new Error(exportBlockedBy || "Wait for the preview to finish updating.");
      const snapshot = { geometry, project };
      return automaticNesting.prepare(snapshot.geometry, snapshot.project).then(layout => {
        if (snapshot.geometry !== geometry || snapshot.project !== project) throw new Error("The design changed while arranging sheets. Export again when the preview is ready.");
        return { geometry: snapshot.geometry, ...layout };
      });
    }, () => {
      atommReady = true;
      if (embeddedInPlatform && window.atomm) void readAtommLocale(window.atomm).then((locale) => { if (!cancelled) document.documentElement.lang = locale; });
    }, (update) => {
      exportNotice.apply(update);
      if (update.phase === "ready") trackUsage("export_prepared", project.outputMode, "atomm");
      if (update.phase === "error") trackUsage("export_failed", project.outputMode, "atomm");
    });
    void restoreStartupProject({
      loadProject,
      search: window.location.search,
      loadLakeLocation: () => import("$lib/site/lake-location"),
      consumeLakeLink: async () => {
        const { replaceState } = await import("$app/navigation");
        const url = new URL(window.location.href);
        url.searchParams.delete("lake"); url.searchParams.delete("bounds");
        replaceState(url, {});
      },
      hash: window.location.hash,
      loadShareLink: () => import("$lib/studio/share-link"),
      consumeShareLink: async () => {
        const { replaceState } = await import("$app/navigation");
        const url = new URL(window.location.href);
        url.hash = "";
        url.searchParams.delete("generate");
        replaceState(url, {});
      },
      loadExample: async (slug) => {
        const response = await fetch(`${base}/examples/${slug}.json`);
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`Example request failed with status ${response.status}.`);
        return response.json();
      },
      consumeExampleLink: async () => {
        const { replaceState } = await import("$app/navigation");
        const url = new URL(window.location.href);
        url.searchParams.delete("example");
        replaceState(url, {});
      },
      isCancelled: () => cancelled,
      currentProject: () => project,
      restoreSaved: (saved) => {
        // A Generate or edit started before the restore finished belongs to
        // the default project; it must neither overwrite nor be undone into it.
        invalidatePendingPreview();
        projectHistory.reset();
        replaceSourceProject(saved, createProjectPreviewSource(saved));
      },
      openLinkedLake: (next, previous) => {
        invalidatePendingPreview();
        projectHistory.push(previous);
        replaceSourceProject(next, createProjectPreviewSource(next));
      },
      generate: () => { void generate(); },
      openSharedProject: (next, previous) => {
        invalidatePendingPreview();
        projectHistory.push(previous);
        dismissedWarnings = [];
        replaceSourceProject(next, createProjectPreviewSource(next));
        trackUsage("share_link_opened", next.outputMode);
      },
      openExample: (next, previous) => {
        invalidatePendingPreview();
        projectHistory.push(previous);
        dismissedWarnings = [];
        replaceSourceProject(next, createProjectPreviewSource(next));
      },
      setStatus: (message) => { status = message; },
    }).then(({ autosave }) => {
      // Autosave must start even when restoring failed, or later edits are lost,
      // unless it would overwrite a saved project that could not be backed up.
      if (!cancelled && autosave) booted = true;
      if (!cancelled) loadRealTerrain();
    });
    // Browser agents (WebMCP) get the studio's own tools. Detected inline so
    // browsers without it never load the module; the Atomm embed never offers them.
    let disconnectWebMcp = () => {};
    const agentContext = (document as unknown as { modelContext?: ModelContextLike }).modelContext ?? (navigator as unknown as { modelContext?: ModelContextLike }).modelContext;
    if (!embeddedInPlatform && import.meta.env.VITE_SITE_ENV !== "atomm" && typeof agentContext?.registerTool === "function") {
      void import("$lib/studio/webmcp").then(({ connectWebMcp }) => { if (!cancelled) disconnectWebMcp = connectWebMcp(agentContext, webMcpHost()); });
    }
    return () => { cancelled = true; disconnectAtomm(); disconnectWebMcp(); exportNotice.dispose(); sheetNesting.dispose(); automaticNesting.dispose(); generationAbort?.abort(); pipeline.dispose(); };
  });

  $effect(() => {
    const current = openSections;
    if (!menuStateReady) return;
    try { localStorage.setItem(MENU_STATE_KEY, JSON.stringify(current)); } catch { /* Preferences are optional. */ }
  });

  /**
   * Never persist a project that would fail validation on the next load —
   * parse failures there would silently reset the user to the default project.
   */
  function canPersist(current: ProjectConfigV1): boolean {
    try { validateProject(current); } catch { return false; }
    return Number.isFinite(current.explodedPreview) && current.explodedPreview >= 0 && current.explodedPreview <= 1;
  }

  /** Persist one snapshot, unless it could not be read back. */
  function persistProject(current: ProjectConfigV1): void {
    if (!canPersist(current)) return;
    void saveProject(current).catch(() => status = "Local save is unavailable in this browser");
  }

  /** The latest snapshot's write, until it runs; leaving the studio in-app fires no `pagehide`. */
  let pendingAutosave: (() => void) | undefined;
  onDestroy(() => pendingAutosave?.());
  $effect(() => {
    const current = project;
    if (!booted) return;
    let written = false;
    let timeout = 0;
    const write = () => { if (written) return; written = true; window.clearTimeout(timeout); persistProject(current); };
    pendingAutosave = write;
    timeout = window.setTimeout(write, 450);
    // A closing, reloading or backgrounded tab must keep this snapshot, but an
    // unloading page abandons IndexedDB transactions it starts (an edit then
    // an immediate reload was lost every time), and can abandon one the
    // debounce started moments earlier. So the snapshot also goes to
    // localStorage synchronously, even when the debounced write already ran;
    // `loadProject` prefers that copy while it is newer. `pagehide` covers
    // close, reload and back/forward cache; `visibilitychange` covers a mobile
    // tab switch that never unloads, where the IndexedDB write does finish.
    const flush = () => {
      if (canPersist(current)) saveProjectUnloadCopy(current);
      write();
    };
    const onHidden = () => { if (document.hidden) flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    };
  });

  // Sheet nesting only arranges finished parts at export, so it never touches generation.
  const COSMETIC_KEYS: ReadonlySet<string> = new Set(["name", "explodedPreview", "sheetNesting"]);
  /** Keys whose edits refresh the preview as custom data rather than a fabrication change. */
  const CUSTOM_DATA_KEYS: ReadonlySet<string> = new Set(["markers", "markerIcons", "customLines", "customGraphics", "placedGraphics"]);
  // Stroke and text styling never changes the terrain request, so a running
  // Generate keeps going and re-renders with the latest style when it finishes.
  const GENERATION_STYLE_KEYS: ReadonlySet<string> = new Set(["lineStyle", "textStyle"]);

  /** Whether an edit to `keys` can leave in-flight generation and preview work running. */
  function keepsPendingWork(keys: readonly string[]): boolean {
    // `[].every` is true, so an empty patch used to keep pending work running
    // at an unchanged revision, and a second refresh could then replace the
    // first one's debounce while sharing its revision guard.
    if (!keys.length) return false;
    const generating = generationState === "loading";
    return keys.every((key) => COSMETIC_KEYS.has(key) || (generating && GENERATION_STYLE_KEYS.has(key)));
  }

  /**
   * Swap in a project with its own source and preview, as import, restore, and
   * directory links do. Generation runs on the geometry worker: a large project
   * (1200 mm, 24 layers) took seconds, and on the main thread it froze the
   * editor before it had finished opening. The retained layers stand in until
   * the worker answers, and the revision guard drops a result a newer edit
   * superseded, exactly as `refreshPreview` does.
   */
  function replaceSourceProject(next: ProjectConfigV1, source: SourceBundleV1): void {
    placement = undefined;
    project = next; sourceProject = next; activeSource = source;
    geometry = { ...geometry, projectName: next.name };
    const revision = pipeline.revision;
    detailsUpdating = true;
    void pipeline.generate(next, source, revision).then((result) => {
      if (!pipeline.isCurrent(revision)) return;
      addPreviewWarning(result, source);
      // A rename during generation is kept, like every other preview commit.
      geometry = { ...result, projectName: project.name };
      selectedLayer = featuredLayerIndex(result);
      detailsUpdating = false;
    }, (error: unknown) => {
      if (!pipeline.isCurrent(revision) || isAbortError(error)) return;
      detailsUpdating = false;
      generationState = "error";
      status = error instanceof Error ? error.message : "Could not update the output geometry.";
    });
  }

  function updateProject(patch: Partial<ProjectConfigV1>): void {
    // Cosmetic edits (rename, exploded-preview slider) and styling must not
    // abort an in-flight generation.
    if (!keepsPendingWork(Object.keys(patch))) invalidatePendingPreview();
    projectHistory.record(project, Object.keys(patch));
    const nextProject = { ...project, ...patch };
    project = nextProject;
    if (typeof patch.name === "string") geometry = { ...geometry, projectName: nextProject.name };
  }
  function updateVerticalExaggeration(verticalExaggeration: number): void {
    if (!Number.isFinite(verticalExaggeration) || verticalExaggeration === project.verticalExaggeration) return;
    void updateFabrication({ verticalExaggeration });
  }

  function updateDepthLayerLimit(value: number): void {
    if (!Number.isFinite(value)) return;
    const waterDepthLayerLimit = Math.max(1, Math.round(value));
    if (waterDepthLayerLimit !== project.waterDepthLayerLimit) void updateFabrication({ waterDepthLayerLimit });
  }

  function updateLocation(patch: Partial<ProjectConfigV1["location"]>): void {
    invalidatePendingPreview();
    projectHistory.record(project, ["location"]);
    project = { ...project, location: { ...project.location, ...patch, ...(("lat" in patch || "lon" in patch || "zoom" in patch) && !("bounds" in patch) ? { bounds: undefined } : {}) } };
    if (!followMapArea()) status = "Map area changed · regenerate terrain data";
  }

  // The platform embed has no Generate step. A moved map area reloads its
  // terrain once the edits settle, as a resized cut already does, and a
  // preview still showing bundled or restored data loads real terrain.
  const AREA_REFRESH_DELAY_MS = 450;
  function followMapArea(): boolean {
    if (!embeddedInPlatform) return false;
    void refreshPreview("fabrication", AREA_REFRESH_DELAY_MS);
    return true;
  }
  function loadRealTerrain(): void {
    if (embeddedInPlatform && activeSource.sourceKind !== "real" && generationState !== "loading") void generate({ automatic: true });
  }
    function closeLocationDialog(): void {
    searchOpen = false;
    window.requestAnimationFrame(() => locationTrigger?.focus());
  }

  function choosePlace(place: PlaceResult): void {
    invalidatePendingPreview();
    projectHistory.push(project);
    project = { ...project, name: (place.surveyedLake ? place.label : place.label.split(",")[0] ?? "Terrain project").slice(0, MAX_PROJECT_NAME_LENGTH),
      ...(place.surveyedLake ? { outputMode: "stack" as const, showWaterDepth: true } : {}),
      location: { ...project.location, lat: place.lat, lon: place.lon, label: place.label, zoom: place.zoom ?? 11, bounds: place.bounds } };
    if (!followMapArea()) status = "Map area changed · regenerate terrain data";
    searchOpen = false;
  }

  /**
   * Undo and redo restore a whole project, so they take the same refresh path
   * as the edit they reverse: a map-area change asks for regeneration, a
   * cosmetic change patches the preview in place, and anything else rebuilds
   * the preview from the retained source.
   */
  function restoreProject(target: ProjectConfigV1, action: "Undo" | "Redo"): void {
    const changed = changedProjectKeys(project, target);
    const sourceChanged = changedProjectKeys(target, sourceProject);
    // Like the edits themselves, undoing a rename or restyle keeps Generate running.
    const keepsWork = keepsPendingWork(changed);
    if (!keepsWork) invalidatePendingPreview();
    project = target;
    if (changed.includes("name")) geometry = { ...geometry, projectName: target.name };
    // Still loading here means the change was kept; generation adopts it on completion.
    if (generationState === "loading") return;
    if (!embeddedInPlatform && !sameMapArea(sourceProject, target) && changed.includes("location")) { status = "Map area changed · regenerate terrain data"; return; }
    status = `${action} applied`;
    // A cosmetic change leaves any pending refresh to finish on its own.
    if (keepsWork || !sourceChanged.some((key) => !COSMETIC_KEYS.has(key))) return;
    const kind: PreviewUpdateKind = sourceChanged.some((key) => key.startsWith("show")) ? "details" : sourceChanged.every((key) => CUSTOM_DATA_KEYS.has(key)) ? "customData" : "fabrication";
    void refreshPreview(kind, 0);
  }
  function resetProject(): void {
    invalidatePendingPreview();
    projectHistory.push(project);
    dismissedWarnings = [];
    explodedDrag = undefined;
    mapAspectLocked = false;
    previewNotice = "";
    mode = threeUnavailable ? "2d" : "3d";
    replaceSourceProject(structuredClone(DEFAULT_PROJECT), createSamplePreviewSource());
    generationState = "ready";
    status = "Project reset to Crater Lake defaults · Undo restores your previous settings";
    loadRealTerrain();
  }

  function undo(): boolean { if (placement) return false; const previous = projectHistory.undo(project); if (previous) restoreProject(previous, "Undo"); return Boolean(previous); }
  function redo(): void { if (placement) return; const next = projectHistory.redo(project); if (next) restoreProject(next, "Redo"); }

  function handleHistoryKey(event: KeyboardEvent): void {
    const shortcut = historyShortcut(event);
    // An undo would rewrite the project under an open draft; Done or Cancel first.
    if (!shortcut || placement) return;
    event.preventDefault();
    if (shortcut === "undo") undo(); else redo();
  }

  function invalidatePendingPreview(): void {
    const wasGenerating = generationState === "loading";
    generationAbort?.abort();
    pipeline.invalidate();
    detailsUpdating = false;
    terrainRefreshing = false;
    if (wasGenerating) generationState = "idle";
  }

  const styleOf = (config: ProjectConfigV1) => JSON.stringify([config.lineStyle, config.textStyle]);

  /**
   * Rebuild the preview for the current project from the retained source, loading only missing map data.
   * A `quiet` refresh keeps the status line and generation state, so a failure or cancellation message stays visible.
   */
  function refreshPreview(kind: PreviewUpdateKind, delayMs: number, { quiet = false }: { quiet?: boolean } = {}): Promise<void> {
    const nextProject = project;
    const previewProject = nextProject;
    const areaChanged = !sameMapArea(sourceProject, nextProject);
    let loaded: Awaited<ReturnType<typeof loadTerrain>> | undefined;
    const fromProject = sourceProject;
    const fromSource = activeSource;
    const patch = projectPatch(fromProject, previewProject);
    detailsUpdating = true;
    terrainRefreshing = areaChanged;
    if (!quiet) status = `${embeddedInPlatform ? "Step 1 of 2 · " : ""}${areaChanged ? "Fetching terrain for the updated map area…" : previewPendingStatus(kind, nextProject)}`;
    return pipeline.runPreviewUpdate({
      config: previewProject,
      prepareSource: async (signal) => {
        const source = !areaChanged
          ? await (await preparedSources()).prepare(fromSource, fromProject, previewProject, nextProject, signal)
          : (loaded = await loadTerrain(previewProject, signal)).source;
        if (!signal.aborted && !quiet && embeddedInPlatform) status = "Step 2 of 2 · Building preview geometry…";
        return source;
      },
      onCommit: (next, source) => {
        if (loaded?.fallback) next.warnings.push({ code: "DATA_FALLBACK", message: `The map service was unavailable, so this preview uses deterministic sample terrain.${loaded.fallbackReason ? ` (${loaded.fallbackReason})` : ""}` });
        if (loaded?.waterWarning) next.warnings.push({ code: "LAKE_DATA_UNAVAILABLE", message: `Water outlines could not be applied. (${loaded.waterWarning})` });
        addPreviewWarning(next, source);
        if (areaChanged) dismissedWarnings = [];
        // Cosmetic edits do not supersede a refresh, so keep the latest name.
        geometry = { ...next, projectName: project.name }; activeSource = source; sourceProject = previewProject;
        selectedLayer = (kind === "details" ? layerForEnabledDetail(next, patch) : undefined) ?? Math.min(selectedLayer, Math.max(0, next.layers.length - 1));
        if (quiet) return;
        if (generationState === "error") generationState = "ready";
        status = embeddedInPlatform && areaChanged && source.sourceKind === "real" ? "Terrain loaded for the new map area" : previewUpdatedStatus(kind, source, nextProject, sourceRequirements(nextProject));
      },
      onError: (error) => {
        if (quiet) { console.error("TopoStack could not restyle the preview.", error); return; }
        generationState = "error";
        status = error instanceof Error ? error.message : kind === "details" ? "Could not update map details." : "Could not update the output geometry.";
      },
      onSettled: (current) => { if (current) { detailsUpdating = false; terrainRefreshing = false; } },
    }, delayMs);
  }

  function updateMapDetails(patch: Partial<ProjectConfigV1>, delayMs = PREVIEW_REFRESH_DELAY_MS): Promise<void> {
    updateProject(patch);
    return refreshPreview("details", delayMs);
  }

  function updateFabrication(patch: Partial<ProjectConfigV1>, delayMs = PREVIEW_REFRESH_DELAY_MS): Promise<void> {
    const updatesCustomData = patch.markers !== undefined || patch.customLines !== undefined || "customGraphics" in patch || "placedGraphics" in patch;
    const nextWidth = patch.widthMm ?? project.widthMm;
    const nextHeight = patch.heightMm ?? project.heightMm;
    const maximumNorthArrowSize = edits.northArrowMaximumMm(nextWidth, nextHeight);
    if ((patch.widthMm !== undefined || patch.heightMm !== undefined) && (patch.northArrowSizeMm ?? project.northArrowSizeMm) > maximumNorthArrowSize) {
      patch = { ...patch, northArrowSizeMm: maximumNorthArrowSize };
    }
    updateProject(patch);
    // A style edit kept a running Generate alive; it renders the new style itself.
    if (generationState === "loading") return Promise.resolve();
    return refreshPreview(updatesCustomData ? "customData" : "fabrication", delayMs);
  }

  const MAP_DETAIL_KEYS = new Set<string>(["showWater", "showWaterDepth", "showRoads", "showTrails", "showTransportationLabels", "showBoundaries", "showCoordinateGrid", "showElevationLabels", "showNorthArrow", "showScaleBar"]);

  /** An agent's settings change, applied the way the matching controls apply it. */
  function applyAgentPatch(patch: Partial<ProjectConfigV1>): Promise<void> {
    if (patch.outputMode && patch.outputMode !== project.outputMode) mode = patch.outputMode === "engraving" ? "engraving" : threeUnavailable ? "2d" : "3d";
    const keys = Object.keys(patch);
    if (keys.every((key) => key === "name")) { updateProject(patch); return Promise.resolve(); }
    if (keys.every((key) => key === "name" || MAP_DETAIL_KEYS.has(key))) return updateMapDetails(patch);
    return updateFabrication(patch);
  }

  /** The live studio as the WebMCP tools see it; getters, so no tool reads a stale closure. */
  function webMcpHost(): WebMcpHost {
    return {
      project: () => project,
      geometry: () => geometry,
      generationState: () => generationState,
      status: () => status,
      exportBlockedBy: () => exportBlockedBy,
      searchPlaces: (query) => searchPlaces(query),
      setLocation: (location, name) => {
        invalidatePendingPreview();
        projectHistory.push(project);
        project = { ...project, ...(name ? { name } : {}), location };
        if (!followMapArea()) status = "Map area changed · regenerate terrain data";
      },
      applyPatch: applyAgentPatch,
      generate: () => generate(),
      undo,
      openExport: () => { exportOpen = true; },
      editBlockedBy: () => placement ? "The studio is placing an item. Finish or cancel it there first." : undefined,
    };
  }

  /** An `automatic` run is the embed loading terrain on its own: it keeps the current view and skips the progress toasts. */
  async function generate({ automatic = false }: { automatic?: boolean } = {}): Promise<void> {
    // A chart saved again since a lake took it (a project imported with a newer
    // copy) carves as it is now, so the project says so before it is built:
    // otherwise the design's fingerprint would name content that was not carved.
    // This is bookkeeping, not an edit, so it is not an undo step.
    // When the chart store cannot be read, the references stay as they are and
    // loading warns about any chart it cannot find.
    const charts = project.userDepthCharts;
    if (charts) {
      const current = await import("$lib/storage/user-charts").then(({ currentChartReferences }) => currentChartReferences(charts)).catch(() => charts);
      if (current !== project.userDepthCharts) project = { ...project, userDepthCharts: current };
    }
    invalidatePendingPreview();
    const revision = pipeline.revision;
    const controller = new AbortController(); generationAbort = controller;
    const generationProject: ProjectConfigV1 = { ...project, location: { ...project.location, bounds: boundsForProject(project) } };
    generationState = "loading"; generationStep = 1; status = "Fetching elevation and map details…";
    trackUsage("generation_started", generationProject.outputMode);
    const progressToast = automatic ? Promise.resolve(undefined) : showToast({ type: "info", message: "Building terrain layers…", duration: 0 });
    // Throws at each await boundary once canceled (AbortError) or superseded by a newer edit.
    const checkpoint = () => { controller.signal.throwIfAborted(); if (!pipeline.isCurrent(revision)) throw new DOMException("Generation superseded", "AbortError"); };
    try {
      const loaded = await loadTerrain(generationProject, controller.signal, (stage) => {
        if (controller.signal.aborted || !pipeline.isCurrent(revision)) return;
        generationStep = stage === "fetching" ? 1 : 2;
        status = stage === "fetching" ? "Fetching elevation and map details…" : "Preparing terrain and lake depths…";
      });
      checkpoint();
      generationStep = 3; status = "Tracing and repairing contours…";
      let builtProject = generationProject;
      let next = await pipeline.generate(builtProject, loaded.source, revision);
      checkpoint();
      // Styling edited during the run did not cancel it; render again until the style is current.
      while (styleOf(builtProject) !== styleOf(project)) {
        builtProject = { ...builtProject, lineStyle: project.lineStyle, textStyle: project.textStyle };
        next = await pipeline.generate(builtProject, loaded.source, revision);
        checkpoint();
      }
      if (loaded.fallback) next.warnings.push({ code: "DATA_FALLBACK", message: `The map service was unavailable, so this preview uses deterministic sample terrain.${loaded.fallbackReason ? ` (${loaded.fallbackReason})` : ""}` });
      if (loaded.waterWarning) next.warnings.push({ code: "LAKE_DATA_UNAVAILABLE", message: `Water outlines could not be applied, so the terrain has no water adjustment. (${loaded.waterWarning})` });
      for (const lake of loaded.missingCharts ?? []) next.warnings.push({ code: "BATHYMETRY_FALLBACK", message: `The depth chart for ${lake} is unavailable or has not completed contour review, so it is carved without it. Import a reviewed project file or recreate the chart from its source.` });
      // Cosmetic edits deliberately do not cancel expensive terrain work. Merge
      // their latest values instead of replacing them with the request snapshot.
      // Names are bookkeeping and do not cancel a run either; keep the ones typed meanwhile.
      const completedProject = { ...builtProject, name: project.name, explodedPreview: project.explodedPreview, markers: edits.withLiveNames(builtProject.markers, project.markers), customLines: edits.withLiveNames(builtProject.customLines, project.customLines) };
      const completedGeometry = { ...next, projectName: completedProject.name };
      dismissedWarnings = [];
      void sourcePreparation?.then((cache) => cache.clear(), () => undefined);
      geometry = completedGeometry; project = completedProject; activeSource = loaded.source; sourceProject = completedProject; selectedLayer = featuredLayerIndex(completedGeometry);
      // Show the result, unless the maker is at work in the custom data view.
      if (!automatic && mode !== "custom") mode = completedProject.outputMode === "engraving" ? "engraving" : threeUnavailable ? "2d" : "3d";
      generationState = "ready";
      trackUsage(exportBlockReason(completedGeometry, completedProject) ? "generation_failed" : "generation_succeeded", completedProject.outputMode);
      const outcome = {
        fallback: loaded.fallback, fallbackReason: loaded.fallbackReason, waterWarning: loaded.waterWarning,
        vectorUnavailable: next.vectorStatus !== "available" && (generationProject.showRoads || generationProject.showTrails || generationProject.showWater || generationProject.showBoundaries || (generationProject.outputMode === "stack" && generationProject.showWaterDepth)),
        lakeUnavailable: generationProject.outputMode === "stack" && generationProject.showWaterDepth && next.lakeDataStatus !== "available",
      };
      status = generationStatus(outcome, generationProject, next);
      if (!automatic) void showToast(generationToast(outcome, generationProject));
    } catch (error) {
      if (!pipeline.isCurrent(revision)) { trackUsage("generation_cancelled", generationProject.outputMode); return; }
      const canceled = controller.signal.aborted || isAbortError(error);
      trackUsage(canceled ? "generation_cancelled" : "generation_failed", generationProject.outputMode);
      if (canceled) { generationState = "idle"; status = "Generation canceled"; }
      else { generationState = "error"; status = error instanceof Error ? error.message : "Generation failed. Check the location and try again."; void showToast({ type: "error", message: "Could not generate terrain" }); }
      // Style edits made during the run skipped their own refresh, expecting this
      // generation to render them. Apply them to the retained preview instead.
      if (styleOf(project) !== styleOf(sourceProject)) void refreshPreview("fabrication", 0, { quiet: true });
    } finally {
      if (generationAbort === controller) generationAbort = undefined;
      void progressToast.then((toast) => toast && window.atomm ? window.atomm.ui.closeToast(toast) : undefined).catch(() => undefined);
    }
  }
  function cancelGeneration(): void {
    // Loading terrain for a moved map area is a refresh, not a Generate run.
    // Stopping it keeps the previous terrain, and the lead rail offers to load it again.
    if (terrainRefreshing) { invalidatePendingPreview(); generationState = "idle"; status = "Terrain loading canceled"; return; }
    generationAbort?.abort(); pipeline.cancelGeometry(new DOMException("Generation canceled", "AbortError"));
  }

  function showToast(options: Parameters<NonNullable<typeof window.atomm>["ui"]["toast"]>[0]): Promise<string | undefined> {
    if (!window.atomm) return Promise.resolve(undefined);
    return window.atomm.ui.toast(options).catch(() => undefined);
  }

  function downloadProject(option: DownloadOption): Promise<void> {
    return downloadWithNotice({ option, geometry, project, sheetPlan: sheetNesting.exportPlan, notice: exportNotice, track: (event) => trackUsage(event, project.outputMode, "browser") });
  }
  async function importProject(file: File | undefined): Promise<void> {
    if (!file) return;
    // A rejected file leaves a running Generate alone: report it on the status line only.
    const reportImportError = (message: string) => { status = message; if (generationState !== "loading") generationState = "error"; };
    if (file.size > MAX_PROJECT_BUNDLE_BYTES) { reportImportError("Project file must be 24 MB or smaller."); return; }
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const envelope = parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : undefined;
      const charts = envelope && Array.isArray(envelope.charts) ? envelope.charts : [];
      // Only a file carrying traced depth charts may be large; everything else keeps the old ceiling.
      if (!charts.length && file.size > MAX_PROJECT_FILE_BYTES) { reportImportError("Project file must be 2 MB or smaller."); return; }
      const candidate = envelope && "project" in envelope ? envelope.project : parsed;
      const imported = parseProject(candidate);
      const saved = charts.length ? await (await import("$lib/storage/user-charts")).saveProjectCharts(charts, imported) : { saved: 0, skipped: 0 };
      const source = createProjectPreviewSource(imported); invalidatePendingPreview(); projectHistory.push(project); dismissedWarnings = []; replaceSourceProject(imported, source); generationState = "ready";
      status = saved.saved ? `Project imported with ${saved.saved === 1 ? "its depth chart" : `${saved.saved} depth charts`} · generate to refresh its terrain` : "Project imported · generate to refresh its terrain";
      loadRealTerrain();
    }
    catch (error) { reportImportError(error instanceof Error ? error.message : "Could not import this project."); }
  }

  async function shareLink(): Promise<string> {
    const { shareLinkFor } = await import("$lib/studio/share-link");
    return shareLinkFor(project, new URL("/studio", window.location.href).toString());
  }

  async function copyShareLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(await shareLink());
      status = "Share link copied · anyone with it can open this design";
      trackUsage("share_link_copied", project.outputMode);
    } catch (error) {
      status = error instanceof Error && error.name !== "NotAllowedError" ? error.message : "Could not copy the share link. Check clipboard permissions and try again.";
    }
  }

  /** Hands the link to the system share sheet; browsers without one, and share failures, copy it instead. */
  async function shareDesign(): Promise<void> {
    let url: string;
    try { url = await shareLink(); } catch (error) { status = error instanceof Error ? error.message : "Could not create the share link."; return; }
    const data = { title: `${project.name.trim() || "Topographic map"} · TopoStack`, text: "A topographic map design made with TopoStack", url };
    if (typeof navigator.share !== "function" || navigator.canShare?.(data) === false) return copyShareLink();
    try {
      await navigator.share(data);
      status = "Design shared · anyone with the link can open it";
      trackUsage("share_link_shared", project.outputMode);
    } catch (error) {
      // Closing the share sheet is not a failure.
      if (error instanceof Error && error.name === "AbortError") return;
      await copyShareLink();
    }
  }

  async function importCustomData(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const { importGeoFile } = await import("$lib/domain/geo-import");
      const { patch, message } = await importGeoFile(file, edits.customDataCapacity(project), boundsForProject(project));
      status = message;
      if (!patch) return;
      if (!keepsPendingWork(Object.keys(patch))) invalidatePendingPreview();
      // One import is one undo step, however many features it adds.
      projectHistory.push(project);
      project = { ...project, ...edits.appendCustomData(project, patch, () => crypto.randomUUID()) };
      if (generationState !== "loading") void refreshPreview("customData", 0, { quiet: true });
    } catch (error) {
      status = error instanceof Error ? error.message : "Could not import this map data file.";
    }
  }

  // The sidebar panels and preview read App state through this object; see StudioContext.
  provideStudio({
    get project() { return project; },
    get sourceProject() { return sourceProject; },
    get activeSource() { return activeSource; },
    get geometry() { return geometry; },
    get outputMode() { return outputMode; },
    get stackPlan() { return stackPlan; },
    get stackLayerCount() { return stackLayerCount; },
    get contourInterval() { return contourInterval; },
    get seamGrid() { return seamGrid; },
    get seamSummary() { return seamSummary; },
    get northArrowSizeLimitMm() { return northArrowSizeLimitMm; },
    get activeLinePreset() { return activeLinePreset; },
    get detailCounts() { return detailCounts; },
    get modeledLakes() { return modeledLakes; },
    get hasDepthOverride() { return hasDepthOverride; },
    get layerTicks() { return layerTicks; },
    get terrainDataStale() { return terrainDataStale; },
    get verticalExaggerationStale() { return verticalExaggerationStale; },
    get terrainDataAction() { return terrainDataAction; },
    get lakeDepthFittingOn() { return lakeDepthFittingOn; },
    get visibleWarnings() { return visibleWarnings; },
    get generationState() { return generationState; },
    get generationStep() { return generationStep; },
    get status() { return status; },
    get detailsUpdating() { return detailsUpdating; },
    get terrainRefreshing() { return terrainRefreshing; },
    get previewBusy() { return previewBusy; },
    get previewBusyLabel() { return previewBusyLabel; },
    get exportPhase() { return exportPhase; },
    get exportBlockedBy() { return exportBlockedBy; },
    get exportReady() { return exportReady; },
    sheetNesting,
    get outputSummary() { return outputSummary; },
    get booted() { return booted; },
    get historyAvailability() { return historyAvailability; },
    get embeddedInPlatform() { return embeddedInPlatform; },
    get explodedPreview() { return explodedPreview; },
    get previewModeOptions() { return previewModeOptions; },
    get MapCanvas() { return MapCanvas; },
    get EngravingPreview() { return EngravingPreview; },
    get TwoDPreview() { return TwoDPreview; },
    get ThreePreview() { return ThreePreview; },
    get engravingPreview() { return engravingPreview; },
    get twoDPreview() { return twoDPreview; },
    get PlacementStage() { return PlacementStage; },
    get CustomDataView() { return CustomDataView; },
    get customDataView() { return customDataView; },
    get mapCanvas() { return mapCanvas; },
    get ExportPreview() { return ExportPreview; },
    get exportPreview() { return exportPreview; },
    get placement() { return placement; },
    set placement(value) { placement = value; },
    get placementBackdrop() { return placementBackdrop; },
    get placementPhase() { return placementPhase; },
    get placementFade() { return placementFade; },
    get placementMargin() { return placementMargin; },
    get placementHiddenPrefixes() { return placementHiddenPrefixes; },
    get openSections() { return openSections; },
    get shownLengthUnit() { return shownLengthUnit; },
    get shownElevationUnit() { return shownElevationUnit; },
    get mode() { return mode; },
    set mode(value) { mode = value; },
    get threeUnavailable() { return threeUnavailable; },
    set threeUnavailable(value) { threeUnavailable = value; },
    get previewNotice() { return previewNotice; },
    set previewNotice(value) { previewNotice = value; },
    get selectedLayer() { return selectedLayer; },
    set selectedLayer(value) { selectedLayer = value; },
    get explodedDrag() { return explodedDrag; },
    set explodedDrag(value) { explodedDrag = value; },
    get searchOpen() { return searchOpen; },
    set searchOpen(value) { searchOpen = value; },
    get resetOpen() { return resetOpen; },
    set resetOpen(value) { resetOpen = value; },
    get mapAspectLocked() { return mapAspectLocked; },
    set mapAspectLocked(value) { mapAspectLocked = value; },
    get placingMarker() { return customData.placingMarker; },
    set placingMarker(value) { customData.setPlacingMarker(value); },
    get lineDraft() { return customData.lineDraft; },
    get lineworkOpen() { return lineworkOpen; },
    set lineworkOpen(value) { lineworkOpen = value; },
    get locationTrigger() { return locationTrigger; },
    set locationTrigger(value) { locationTrigger = value; },
    shownLength, shownDepth, shownLineWidth, shownTextSize, storedLength, workAreaLength, updateProject, updateFabrication, updateMapDetails, updateLocation, updateVerticalExaggeration, updateDepthLayerLimit, setLakeDepth, setLineWidth, applyCustomDataEdit,
    renameCustomData: (patch) => customData.rename(patch),
    startLineDraft: () => customData.startLineDraft(),
    extendLineDraft: (point) => customData.extendLineDraft(point),
    commitLineDraft: (closed) => customData.commitLineDraft(closed),
    cancelLineDraft: () => customData.cancelLineDraft(),
    saveChartToLibrary: (record) => customData.saveChartToLibrary(record),
    useChartForLake: (key, reference) => customData.useChartForLake(key, reference),
    clearDepthChart: (key) => customData.clearDepthChart(key),
    importMarkerIcon: (file, markerId) => customData.importMarkerIcon(file, markerId), importGraphic: (file) => customData.importGraphic(file), choosePlace, startPlacement, placeGraphic, placeGraphics, commitPlacement, cancelPlacement, undo, redo, importProject, copyShareLink, shareDesign, importCustomData, generate, cancelGeneration, toggleSection, setAllSections, sectionSummary, navigateChoice, dismissPreviewWarning, previewMarkingPath, trailPatternDash, getFeedbackContext,
  });
</script>

<svelte:window onkeydown={handleHistoryKey} />

<svelte:head>
  <meta name="theme-color" content={themeColor} />
</svelte:head>

{#snippet locationSearch()}
  <!-- One dialog for both shells: the embedded and standalone branches rendered
       identical copies, so a prop or handler change had to be made twice. -->
  {#if searchOpen && LocationDialog}<LocationDialog {project} presets={PRESETS} onChoose={choosePlace} onCoordinates={(lat, lon) => updateLocation({ lat, lon, label: "Custom coordinates" })} onClose={closeLocationDialog} />{/if}
{/snippet}

{#if embeddedInPlatform}
  {#if AtommWorkbench}<AtommWorkbench ready={atommReady} blockedReason={previewBusy ? undefined : activeSource.sourceKind !== "real" || terrainDataStale ? "Export is available once the terrain for this area has loaded." : exportBlockedBy} preparing={exportPhase === "preparing"} {exportPhase} {exportTitle} {exportDetail}>
    {#snippet leadHeader()}<ProjectControls />{/snippet}
    {#snippet lead()}<OutputSwitch />{#if mode === "custom"}{#if CustomDataNav}<CustomDataNav />{:else if customDataNav.failed}<p class="panel-loading" role="alert">Custom data tools could not load. <button type="button" class="btn btn-secondary" onclick={() => customDataNav.load()}>Retry</button></p>{:else}<p class="panel-loading" role="status">Loading custom data tools…</p>{/if}{:else}<SetupSection /><CustomDataSection />{/if}{/snippet}
    {#snippet generate()}{#if mode !== "custom"}<GenerationDock />{/if}{/snippet}
    {#snippet parameterHeader()}
      <UnitSwitch />
      <button type="button" class="btn btn-secondary" onclick={() => void updateFabrication({ ...DEFAULT_PROJECT, id: project.id, name: project.name, location: project.location, outputMode: project.outputMode })}>Reset</button>
    {/snippet}
    {#snippet parameters(openLakeDepthHelp)}<LayerDock /><ParameterSections {openLakeDepthHelp} />{/snippet}
    {#snippet preview(openLakeDepthHelp)}<PreviewPanel {openLakeDepthHelp} />{/snippet}
    {#snippet dialogs()}{@render locationSearch()}{/snippet}
  </AtommWorkbench>{:else}<main role="status">{atommLayoutFailed ? "The platform layout could not load. Reload to try again." : "Preparing terrain studio…"}</main>{/if}
{:else}
<AppShell class="app-shell">
  {#snippet header()}
    <div class="app-header">
      <Topbar class="topbar">
        {#snippet brand()}<Brand name="TopoStack" meta="Studio" />{/snippet}
        {#snippet navigation()}
          <ProjectControls />
        {/snippet}
        {#snippet actions()}
          <Button class="export-trigger" aria-label="Export" aria-describedby="export-status" title={exportStatusLabel} aria-haspopup="dialog" onclick={(event: MouseEvent) => { if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus(); exportOpen = true; }}><Download size={18} aria-hidden="true" /><span class="export-trigger-label">Export</span><span class="export-status-dot" data-status={exportStatusTone} aria-hidden="true"></span></Button>
          <span id="export-status" class="context-export-status ldt-visually-hidden">{exportStatusLabel}</span>
          <StudioMenu />
        {/snippet}
      </Topbar>
      <ContextBar class="terrain-contextbar" section="Terrain" title={project.location.label.split(",")[0]} detail={project.location.label.split(",").slice(1).join(",") || "Selected coordinates"}>
        {#snippet actions()}
          <OutputSwitch />
        {/snippet}
      </ContextBar>
    </div>
  {/snippet}

  <Workspace class="workspace">
    {#snippet sidebar()}
    <Sidebar class="config-panel">
      <div class="panel-scroll">
        {#if mode === "custom"}
          <!-- The custom data view is its own job. The project's size, terrain
               and linework controls have nothing to say about tracing a chart,
               so the sidebar becomes a menu over what that view shows. -->
          <div class="panel-intro">
            <span class="section-kicker panel-eyebrow">Custom data</span>
            <h1>Bring your own data.</h1>
            <p>Charts you trace, points you place, routes you import. Markers and paths join the project as you add them; a chart carves a lake only when you say so.</p>
          </div>
          {#if CustomDataNav}<CustomDataNav />{:else if customDataNav.failed}<p class="panel-loading" role="alert">Custom data tools could not load. <button type="button" class="btn btn-secondary" onclick={() => customDataNav.load()}>Retry</button></p>{:else}<p class="panel-loading" role="status">Loading custom data tools…</p>{/if}
        {:else}
          <div class="panel-intro">
            <span class="section-kicker panel-eyebrow">Project controls</span>
            <h1>{project.outputMode === "engraving" ? "Draw the landscape." : "Build the landscape."}</h1>
            <p>Work through the essentials, then open details only when you need them.</p>
            <div class="section-tools" aria-label="Section display controls">
              <button type="button" onclick={() => setAllSections(true)} disabled={shownSections.every((section) => openSections[section])}>Expand all</button>
              <button type="button" onclick={() => setAllSections(false)} disabled={shownSections.every((section) => !openSections[section])}>Collapse all</button>
            </div>
          </div>
          <SetupSection />

          <ParameterSections />
        {/if}
      </div>
      {#if mode !== "custom"}<GenerationDock />{/if}
    </Sidebar>
    {/snippet}

    <PreviewPanel />
  </Workspace>
  <ExportDialog open={exportOpen} {project} summary={outputSummary.join(" · ")} panelCount={fabricationPanelCount} nested={Boolean(sheetNesting.exportPlan)} blockedReason={exportBlockedBy} preparing={exportPhase === "preparing"} phase={exportPhase} title={exportTitle} detail={exportDetail} onDownload={(option) => void downloadProject(option)} onClose={() => exportOpen = false}>
    {#snippet sheetLayout()}<SheetLayoutSection disabled={Boolean(exportBlockedBy)} />{/snippet}
  </ExportDialog>
  {@render locationSearch()}
</AppShell>

{/if}

{#if resetOpen}<ResetProjectDialog onConfirm={() => { resetOpen = false; resetProject(); }} onClose={() => resetOpen = false} />{/if}
