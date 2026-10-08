<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { base } from "$app/paths";
  import { Download } from "@lucide/svelte";
  import { AppShell, Brand, Button, ContextBar, Sidebar, Topbar, Workspace, readRoleColor } from "@loidolt/theme-svelte";
  import { sourceRequirements, DEFAULT_PROJECT, FEET_PER_METER, planSeamGrid, displayElevation, displayLength, elevationUnit, generateGeometry, labelPathData, lengthUnit, MAX_PROJECT_NAME_LENGTH, millimetersFromDisplay, planTerrainStack, projectFingerprint, type GeometryIRV1, type LineStyleV1, type OperationPath, type ProjectConfigV1, type SourceBundleV1 } from "@topostack/core";
  import type { TerrainLoadResult } from "$lib/domain/data-provider";
  import { searchPlaces, type PlaceResult } from "$lib/domain/geocode";
  import { CustomDataActions } from "$lib/studio/customdata/custom-data-actions.svelte";
  import { theme } from "$lib/site/theme";
  import { trackUsage } from "$lib/site/usage";
  import { networkSignal } from "$lib/domain/network";
  import { createSamplePreviewSource } from "$lib/domain/sample-preview";
  import { boundsForProject, exportBlockReason } from "@topostack/core";
  import { readProjectFile } from "$lib/studio/project-file";
  import { copyShareLink as copyDesignLink, shareDesign as shareDesignLink } from "$lib/studio/share-design";
  import { loadProject } from "$lib/storage/storage";
  import { AutomaticNesting } from "$lib/atomm/automatic-nesting";
  import { provideAutomaticNesting, provideEmbedded } from "$lib/studio/embed-context";
  import { connectAtomm } from "$lib/atomm/atomm-bridge";
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
  import { MenuSections } from "$lib/studio/menu-sections.svelte";
  import { keepsPendingWork as keepsPendingEdits, refreshKindFor } from "$lib/studio/edit-classification";
  import { autosaveProject } from "$lib/studio/autosave.svelte";
  import { historyShortcut } from "$lib/studio/history-keys";
  import { ATOMM_ENGRAVING_MODE_OPTIONS, ATOMM_STACK_MODE_OPTIONS, ENGRAVING_MODE_OPTIONS, PRESETS, STACK_MODE_OPTIONS } from "$lib/studio/options";
  import * as edits from "$lib/studio/project-edits";
  import { isAbortError, loadGeometryClient, PreviewPipeline } from "$lib/studio/preview-pipeline";
  import type { WarmGeometryWorker } from "$lib/workers/geometry-worker-client";
  import { LazyComponent } from "$lib/studio/lazy-component";
  import { PlacementController } from "$lib/studio/placement/placement-controller.svelte";
  import { createProjectPreviewSource } from "$lib/studio/project-preview";
  import { restoreStartupProject } from "$lib/studio/startup-restore";
  import { acrylicPanelCount as findAcrylicPanelCount, activeLinePreset as findActiveLinePreset, CONFIG_SECTION_IDS, countDetailMarkings, featuredLayerIndex, layerForEnabledDetail, modeledLakes as findModeledLakes, sectionSummary as summarizeSection, visibleWarnings as summarizeWarnings, type ConfigSectionId } from "$lib/studio/preview-summary";
  import { retryingLoader } from "$lib/studio/lazy-load";
  import { sameMapArea } from "$lib/studio/project-diff";
  import { pointsToPath } from "$lib/studio/svg-path";
  import { changedProjectKeys, projectPatch } from "$lib/studio/project-patch";
  import type { SourcePreparationCache } from "$lib/studio/source-refresh";
  import { generationStatus, generationToast, previewPendingStatus, previewUpdatedStatus, type PreviewUpdateKind } from "$lib/studio/status-messages";
  import { nav } from "$lib/studio/customdata/custom-data-nav.svelte";
  import { provideStudio, type GenerateState, type LineWidthKey, type PreviewMode } from "$lib/studio/studio-context";
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
  import StarterSteps from "$lib/studio/panels/StarterSteps.svelte";
  import type { StarterId } from "$lib/site/starters";

  let { initialPreview, initialSource, takeWarmWorker }: {
    initialPreview?: GeometryIRV1;
    /** The decoded sample `initialPreview` was generated from. */
    initialSource?: SourceBundleV1;
    /** Hands over the worker that generated `initialPreview`, if it is still running. */
    takeWarmWorker?: () => WarmGeometryWorker | undefined;
  } = $props();

  function addPreviewWarning(result: GeometryIRV1, source: SourceBundleV1): void {
    if (source.sourceKind === "real" || result.warnings.some((warning) => warning.code === "DATA_FALLBACK")) return;
    result.warnings.push({ code: "DATA_FALLBACK", message: source.sourceKind === "preview" ? "Bundled real-data preview. Generate fresh terrain before exporting." : "Sample preview only. Generate real terrain before exporting." });
  }

  const defaultPreviewSource = untrack(() => initialSource) ?? createSamplePreviewSource();
  // A copy with its own warnings: the warning is added here, never to the caller's prop.
  const startupGeometry = untrack(() => initialPreview) ?? generateGeometry(DEFAULT_PROJECT, defaultPreviewSource);
  const defaultPreviewGeometry: GeometryIRV1 = { ...startupGeometry, warnings: [...startupGeometry.warnings] };
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
  const menuSections = new MenuSections();
  let AtommWorkbench = $state.raw<typeof import("$lib/atomm/AtommWorkbench.svelte").default>();
  let atommLayoutFailed = $state(false);
  let atommReady = $state(false);
  let embeddedInPlatform = $state(false);
  provideEmbedded(() => embeddedInPlatform);
  let exportOpen = $state(false);
  let starterId = $state<StarterId>();
  let exportedFingerprint = $state<string>();
  let previewImageBusy = $state(false);
  let previewImageStatus = $state("");
  let resetOpen = $state(false);
  const exportNotice = new ExportNotice((message) => { status = message; });
  const sheetNesting = new SheetNesting();
  const acrylicSheetNesting = SheetNesting.forAcrylic();
  const automaticNesting = new AutomaticNesting();
  provideAutomaticNesting(automaticNesting);
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
  // The acrylic inserts' own stock sheets follow the same rules as the wood's.
  const acrylicNestSettingsKey = $derived(JSON.stringify([project.waterInsertSheetNesting ?? null, project.workAreaWidthMm, project.workAreaHeightMm]));
  const usesAcrylicSheetNesting = $derived(Boolean(project.waterInsertSheetNesting));
  $effect(() => {
    if (embeddedInPlatform) return;
    const nestGeometry = geometry;
    void acrylicNestSettingsKey;
    const restore = usesAcrylicSheetNesting && nestGeometry.sourceKind === "real" && Boolean(nestGeometry.waterInserts?.length);
    untrack(() => {
      void acrylicSheetNesting.refresh(nestGeometry, project);
      if (restore) void acrylicSheetNesting.restore(nestGeometry, project);
    });
  });
  const exportPhase = $derived(exportNotice.phase);
  const exportTitle = $derived(exportNotice.title);
  const exportDetail = $derived(exportNotice.detail);
  // Re-read whenever the theme resolves to light or dark.
  const themeColor = $derived.by(() => { void theme.resolved; return readRoleColor(document.documentElement, "background") ?? ""; });
  let booted = $state(false);
  let historyAvailability = $state({ canUndo: false, canRedo: false });
  const projectHistory = new ProjectHistory((availability) => { historyAvailability = availability; });
  // Worker lifecycle, edit revisions, and debounced refreshes. Every edit that
  // affects generation invalidates it, so stale work can never commit.
  const pipeline = new PreviewPipeline(() => loadGeometryClient(untrack(() => takeWarmWorker)));
  // The terrain and map-data loaders (pmtiles, vector tiles, polygon
  // clipping, the source catalogs) load with the first Generate or preview
  // edit, not with the studio. A failed load is forgotten, so the next use retries.
  const terrainLoaders = retryingLoader(() => import("$lib/domain/data-provider"), "Terrain loading");
  // Map-data refresh code loads with the first preview edit, not at startup.
  const loadSourcePreparation = retryingLoader(async () => (await import("$lib/studio/source-preparation")).createSourcePreparation(), "Map data refresh");
  let sourcePreparation: Promise<SourcePreparationCache> | undefined;
  const preparedSources = () => sourcePreparation = loadSourcePreparation();
  // Continuous controls (sliders, typed numbers) fire on every input tick. The
  // project value updates immediately; the preview refresh trails the last tick.
  const PREVIEW_REFRESH_DELAY_MS = 120;
  const MAP_AREA_CHANGED = "Map area changed · regenerate terrain data";
  /**
   * Previews wait for the startup project (saved, shared, example, or lake
   * link) so they are not first built for the sample it replaces. Building the
   * 3D scene blocks the main thread for seconds on a slow device and held the
   * link back behind it. A restore that takes longer than this, such as a slow
   * example download, shows the sample's preview meanwhile.
   */
  const STARTUP_PREVIEW_WAIT_MS = 1_000;
  let startupSettled = $state(false);
  /** The view a project opens in: its engraving, or the stack in 3D unless 3D failed. */
  const defaultModeFor = (outputMode: ProjectConfigV1["outputMode"]): PreviewMode => outputMode === "engraving" ? "engraving" : threeUnavailable ? "2d" : "3d";
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
    if (placement.session) threeUnavailable = true;
    if (mode === "3d") { threeUnavailable = true; mode = "2d"; previewNotice = "3D preview could not load · reload to update TopoStack"; }
  });
  const exportPreview = new LazyComponent(() => import("$lib/studio/ExportPreview.svelte"), (error) => {
    console.error("TopoStack could not load the export preview.", error); status = "Export preview could not load · retry or reload to update TopoStack";
  });
  const placementStage = new LazyComponent(() => import("$lib/studio/placement/PlacementStage.svelte"), (error) => {
    console.error("TopoStack could not load placement mode.", error); placement.abandon(); status = "Placement could not load · reload to update TopoStack";
  });
  const customDataView = new LazyComponent(() => import("$lib/studio/customdata/CustomDataView.svelte"), (error) => {
    console.error("TopoStack could not load the custom data view.", error);
    if (mode === "custom") { mode = defaultModeFor(project.outputMode); previewNotice = "Custom data could not load · reload to update TopoStack"; }
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

  const placement = new PlacementController({
    project: () => project,
    geometry: () => geometry,
    mode: () => mode,
    threeUnavailable: () => threeUnavailable,
    loadStage: () => placementStage.load(),
    updateFabrication: (patch) => updateFabrication(patch),
    setStatus: (message) => { status = message; },
  });
  const placementBackdrop = $derived(placement.backdrop);

  $effect(() => {
    const outputMode = project.outputMode;
    if (outputMode === "engraving" && mode !== "map" && mode !== "engraving" && mode !== "custom" && mode !== "export") mode = "engraving";
    else if (outputMode === "stack" && mode === "engraving") mode = threeUnavailable ? "2d" : "3d";
  });

  // Opening place search, the map, or 3D again retries a failed load: their
  // failure handlers already moved away. The engraving and cut previews have
  // no fallback view, so they wait for the Retry button instead of looping.
  $effect(() => {
    if (searchOpen) locationDialog.load();
    if (!startupSettled) return;
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
  // Serializes the whole project, so it is computed once per edit and shared.
  const currentFingerprint = $derived(projectFingerprint(project));
  const stackLayerCount = $derived(geometry.configFingerprint === currentFingerprint ? geometry.layers.length : stackPlan.layerCount);
  const previewModeOptions = $derived(embeddedInPlatform
    ? project.outputMode === "engraving" ? ATOMM_ENGRAVING_MODE_OPTIONS : ATOMM_STACK_MODE_OPTIONS
    : project.outputMode === "engraving" ? ENGRAVING_MODE_OPTIONS : STACK_MODE_OPTIONS);
  const previewBusy = $derived(generationState === "loading" || detailsUpdating);
  const previewBusyLabel = $derived(generationState === "loading" ? "Building your terrain" : terrainRefreshing ? "Loading terrain for this area" : "Refreshing preview");
  const contourInterval = $derived(geometry.landReliefM / (project.engravingContourCount + 1));
  const fabricationPanelCount = $derived(sheetNesting.exportPlan?.sheets.length ?? geometry.layers.length - geometry.fabricationNests.length);
  const acrylicPanelTotal = $derived(acrylicSheetNesting.exportPlan?.sheets.length ?? findAcrylicPanelCount(geometry, project));
  const getFeedbackContext = () => studioFeedbackContext(project, activeSource, geometry, !sameMapArea(sourceProject, project));
  const terrainDataStale = $derived(!sameMapArea(sourceProject, project));
  const verticalExaggerationStale = $derived(project.outputMode === "stack" && sourceProject.verticalExaggeration !== project.verticalExaggeration);
  const terrainDataAction = $derived(embeddedInPlatform ? "load" : geometry.sourceKind === "real" ? "regenerate" : "generate");
  const exportBlockedBy = $derived(exportBlockReason(geometry, project, currentFingerprint));
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
    const depthM = project.units === "imperial" ? shown / FEET_PER_METER : shown;
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
    if (marking.label && marking.points[0]) return labelPathData(marking.label, marking.points[0], 0, 0, marking.labelRotationRad, marking.textStyle);
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


  /** Sidebar sections on screen: markers and paths live in the custom data view outside the Atomm embed. */
  const shownSections = $derived(embeddedInPlatform ? CONFIG_SECTION_IDS : CONFIG_SECTION_IDS.filter((section) => section !== "customData"));

  function setAllSections(open: boolean): void {
    menuSections.setAll(shownSections, open);
  }

  function sectionSummary(section: ConfigSectionId): string {
    return summarizeSection(section, project, stackLayerCount);
  }

  onMount(() => {
    let cancelled = false;
    const settleStartup = () => { if (!cancelled) startupSettled = true; };
    const startupWait = window.setTimeout(settleStartup, STARTUP_PREVIEW_WAIT_MS);
    menuSections.restore();
    embeddedInPlatform = window.parent !== window;
    if (embeddedInPlatform) void import("$lib/atomm/AtommWorkbench.svelte").then((module) => { if (!cancelled) AtommWorkbench = module.default; }).catch(() => { if (!cancelled) atommLayoutFailed = true; });
    const disconnectAtomm = connectAtomm(() => {
      if (!embeddedInPlatform) return { geometry, project, sheetPlan: sheetNesting.exportPlan, acrylicSheetPlan: acrylicSheetNesting.exportPlan };
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
      consumeLakeLink: () => cleanStudioUrl((url) => { url.searchParams.delete("lake"); url.searchParams.delete("bounds"); }),
      hash: window.location.hash,
      loadShareLink: () => import("$lib/studio/share-link"),
      consumeShareLink: () => cleanStudioUrl((url) => { url.hash = ""; url.searchParams.delete("generate"); }),
      loadExample: async (slug) => {
        const response = await fetch(`${base}/examples/${slug}.json`, { signal: networkSignal() });
        if (response.status === 404) return undefined;
        if (!response.ok) throw new Error(`Example request failed with status ${response.status}.`);
        return response.json();
      },
      consumeExampleLink: () => cleanStudioUrl((url) => { url.searchParams.delete("example"); }),
      consumeStarterLink: () => cleanStudioUrl((url) => { url.searchParams.delete("starter"); url.searchParams.delete("example"); url.searchParams.delete("lake"); url.searchParams.delete("bounds"); }),
      onStarterOpened: (id) => { starterId = id; },
      isCancelled: () => cancelled,
      currentProject: () => project,
      restoreSaved: (saved) => {
        // A Generate or edit started before the restore finished belongs to
        // the default project; it must neither overwrite nor be undone into it.
        invalidatePendingPreview();
        projectHistory.reset();
        replaceSourceProject(saved, createProjectPreviewSource(saved));
      },
      openLinkedLake: (next, previous) => openProject(next, previous, { keepWarnings: true }),
      generate: () => { void generate(); },
      openSharedProject: (next, previous) => {
        openProject(next, previous);
        trackUsage("share_link_opened", next.outputMode);
      },
      openExample: (next, previous) => openProject(next, previous),
      setStatus: (message) => { status = message; },
    }).then(({ autosave }) => {
      // Autosave must start even when restoring failed, or later edits are lost,
      // unless it would overwrite a saved project that could not be backed up.
      if (!cancelled && autosave) booted = true;
      if (!cancelled) loadRealTerrain();
      window.clearTimeout(startupWait);
      settleStartup();
    });
    // Browser agents (WebMCP) get the studio's own tools. Detected inline so
    // browsers without it never load the module; the Atomm embed never offers them.
    let disconnectWebMcp = () => {};
    const agentContext = document.modelContext ?? navigator.modelContext;
    if (!embeddedInPlatform && import.meta.env.VITE_SITE_ENV !== "atomm" && typeof agentContext?.registerTool === "function") {
      void import("$lib/studio/webmcp").then(({ connectWebMcp }) => { if (!cancelled) disconnectWebMcp = connectWebMcp(agentContext, webMcpHost()); });
    }
    return () => { cancelled = true; window.clearTimeout(startupWait); disconnectAtomm(); disconnectWebMcp(); exportNotice.dispose(); sheetNesting.dispose(); acrylicSheetNesting.dispose(); automaticNesting.dispose(); generationAbort?.abort(); pipeline.dispose(); placement.dispose(); };
  });

  autosaveProject(() => project, () => booted, () => { status = "Local save is unavailable in this browser"; });

  /** Whether an edit to `keys` can leave in-flight generation and preview work running. */
  const keepsPendingWork = (keys: readonly string[]) => keepsPendingEdits(keys, generationState === "loading");

  /**
   * Swap in a project with its own source and preview, as import, restore, and
   * directory links do. Generation runs on the geometry worker: a large project
   * (1200 mm, 24 layers) took seconds, and on the main thread it froze the
   * editor before it had finished opening. The retained layers stand in until
   * the worker answers, and the revision guard drops a result a newer edit
   * superseded, exactly as `refreshPreview` does.
   */
  function replaceSourceProject(next: ProjectConfigV1, source: SourceBundleV1): void {
    placement.abandon();
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

  /** Open another project as one undo step: a link, an example, or an imported file. */
  function openProject(next: ProjectConfigV1, previous: ProjectConfigV1, { keepWarnings = false }: { keepWarnings?: boolean } = {}): void {
    invalidatePendingPreview();
    projectHistory.push(previous);
    if (!keepWarnings) dismissedWarnings = [];
    replaceSourceProject(next, createProjectPreviewSource(next));
  }

  /** Remove consumed startup parameters from the address bar without a navigation. */
  async function cleanStudioUrl(edit: (url: URL) => void): Promise<void> {
    const { replaceState } = await import("$app/navigation");
    const url = new URL(window.location.href);
    edit(url);
    replaceState(url, {});
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
    if (!followMapArea()) status = MAP_AREA_CHANGED;
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
    if (!followMapArea()) status = MAP_AREA_CHANGED;
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
    if (!embeddedInPlatform && !sameMapArea(sourceProject, target) && changed.includes("location")) { status = MAP_AREA_CHANGED; return; }
    status = `${action} applied`;
    // A cosmetic change leaves any pending refresh to finish on its own.
    const kind = keepsWork ? undefined : refreshKindFor(sourceChanged);
    if (kind) void refreshPreview(kind, 0);
  }
  function resetProject(): void {
    invalidatePendingPreview();
    projectHistory.push(project);
    dismissedWarnings = [];
    explodedDrag = undefined;
    mapAspectLocked = false;
    previewNotice = "";
    mode = defaultModeFor("stack");
    replaceSourceProject(structuredClone(DEFAULT_PROJECT), createSamplePreviewSource());
    generationState = "ready";
    status = "Project reset to Crater Lake defaults · Undo restores your previous settings";
    loadRealTerrain();
  }

  function undo(): boolean { if (placement.session) return false; const previous = projectHistory.undo(project); if (previous) restoreProject(previous, "Undo"); return Boolean(previous); }
  function redo(): void { if (placement.session) return; const next = projectHistory.redo(project); if (next) restoreProject(next, "Redo"); }

  function handleHistoryKey(event: KeyboardEvent): void {
    const shortcut = historyShortcut(event);
    // An undo would rewrite the project under an open draft; Done or Cancel first.
    if (!shortcut || placement.session) return;
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

  /** What loading terrain fell back on, as warnings on the geometry built from it; Generate and a map-area refresh report it alike. */
  function appendLoadWarnings(next: GeometryIRV1, loaded: Pick<TerrainLoadResult, "fallback" | "fallbackReason" | "waterWarning">): void {
    if (loaded.fallback) next.warnings.push({ code: "DATA_FALLBACK", message: `The map service was unavailable, so this preview uses deterministic sample terrain.${loaded.fallbackReason ? ` (${loaded.fallbackReason})` : ""}` });
    if (loaded.waterWarning) next.warnings.push({ code: "LAKE_DATA_UNAVAILABLE", message: `Water outlines could not be applied, so the terrain has no water adjustment. (${loaded.waterWarning})` });
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
    let loaded: TerrainLoadResult | undefined;
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
          : (loaded = await (await terrainLoaders()).loadTerrain(previewProject, signal)).source;
        if (!signal.aborted && !quiet && embeddedInPlatform) status = "Step 2 of 2 · Building preview geometry…";
        return source;
      },
      onCommit: (next, source) => {
        if (loaded) appendLoadWarnings(next, loaded);
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

  const MAP_DETAIL_KEYS = new Set<string>(["showWater", "showWaterDepth", "showRoads", "showTrails", "showTransportationLabels", "showBoundaries", "aviation", "showCoordinateGrid", "showElevationLabels", "showNorthArrow", "showScaleBar"]);

  /** An agent's settings change, applied the way the matching controls apply it. */
  function applyAgentPatch(patch: Partial<ProjectConfigV1>): Promise<void> {
    if (patch.outputMode && patch.outputMode !== project.outputMode) mode = defaultModeFor(patch.outputMode);
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
        if (!followMapArea()) status = MAP_AREA_CHANGED;
      },
      applyPatch: applyAgentPatch,
      generate: () => generate(),
      undo,
      openExport: () => { exportOpen = true; },
      editBlockedBy: () => placement.session ? "The studio is placing an item. Finish or cancel it there first." : undefined,
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
      const { loadTerrain } = await terrainLoaders();
      checkpoint();
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
      appendLoadWarnings(next, loaded);
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
      if (!automatic && mode !== "custom") mode = defaultModeFor(completedProject.outputMode);
      generationState = "ready";
      trackUsage(exportBlockReason(completedGeometry, completedProject) ? "generation_failed" : "generation_succeeded", completedProject.outputMode);
      const outcome = {
        fallback: loaded.fallback, fallbackReason: loaded.fallbackReason, waterWarning: loaded.waterWarning,
        vectorUnavailable: (next.vectorStatus !== "available" && (generationProject.showRoads || generationProject.showTrails || generationProject.showWater || generationProject.showBoundaries || (generationProject.outputMode === "stack" && generationProject.showWaterDepth)))
          || (sourceRequirements(generationProject).aviation && (next.aviationStatus === "unavailable" || next.aviationStatus === "partial")),
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
    const fingerprint = projectFingerprint(project);
    return downloadWithNotice({ option, geometry, project, sheetPlan: sheetNesting.exportPlan, acrylicSheetPlan: acrylicSheetNesting.exportPlan, notice: exportNotice, track: (event) => {
      if (event === "export_prepared") exportedFingerprint = fingerprint;
      trackUsage(event, project.outputMode, "browser");
    } });
  }
  async function importProject(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const { project: imported, savedCharts } = await readProjectFile(file);
      openProject(imported, project); generationState = "ready";
      status = savedCharts ? `Project imported with ${savedCharts === 1 ? "its depth chart" : `${savedCharts} depth charts`} · generate to refresh its terrain` : "Project imported · generate to refresh its terrain";
      loadRealTerrain();
    } catch (error) {
      // A rejected file leaves a running Generate alone: report it on the status line only.
      status = error instanceof Error ? error.message : "Could not import this project.";
      if (generationState !== "loading") generationState = "error";
    }
  }

  async function copyShareLink(): Promise<void> {
    status = await copyDesignLink(project);
    if (exportOpen) previewImageStatus = status;
  }
  async function shareDesign(): Promise<void> {
    const message = await shareDesignLink(project);
    if (message) { status = message; if (exportOpen) previewImageStatus = message; }
  }

  async function savePreviewImage(): Promise<void> {
    if (previewImageBusy || previewBusy || exportBlockedBy) return;
    previewImageBusy = true; previewImageStatus = "Preparing preview image…";
    const snapshot = { geometry, project };
    try {
      const { saveSharePreview } = await import("$lib/studio/share-preview");
      await saveSharePreview(snapshot.geometry, snapshot.project);
      previewImageStatus = "Preview image prepared · pair it with your design link when sharing";
      trackUsage("share_preview_prepared", snapshot.project.outputMode);
    } catch (error) { previewImageStatus = error instanceof Error ? error.message : "Could not prepare the preview image."; }
    finally { previewImageBusy = false; }
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
    acrylicSheetNesting,
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
    get placement() { return placement.session; },
    set placement(value) { placement.session = value; },
    get placementBackdrop() { return placement.backdrop; },
    get placementPhase() { return placement.phase; },
    get placementFade() { return placement.fade; },
    get placementMargin() { return placement.marginMm; },
    get placementHiddenPrefixes() { return placement.hiddenPrefixes; },
    get openSections() { return menuSections.open; },
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
    importMarkerIcon: (file, markerId) => customData.importMarkerIcon(file, markerId), importGraphic: (file) => customData.importGraphic(file), choosePlace, startPlacement: (id) => placement.start(id), placeGraphic: (id) => placement.placeGraphic(id), placeGraphics: () => placement.placeGraphics(), commitPlacement: () => placement.commit(), cancelPlacement: () => placement.cancel(), undo, redo, importProject, copyShareLink, shareDesign, importCustomData, generate, cancelGeneration, toggleSection: (section) => menuSections.toggle(section), setAllSections, sectionSummary, navigateChoice, dismissPreviewWarning, previewMarkingPath, trailPatternDash, getFeedbackContext,
  });
</script>

<svelte:window onkeydown={handleHistoryKey} />

<svelte:head>
  <meta name="theme-color" content={themeColor} />
</svelte:head>

{#snippet customDataTools()}{#if CustomDataNav}<CustomDataNav />{:else if customDataNav.failed}<p class="panel-loading" role="alert">Custom data tools could not load. <button type="button" class="btn btn-secondary" onclick={() => customDataNav.load()}>Retry</button></p>{:else}<p class="panel-loading" role="status">Loading custom data tools…</p>{/if}{/snippet}

{#snippet locationSearch()}
  <!-- One dialog for both shells: the embedded and standalone branches rendered
       identical copies, so a prop or handler change had to be made twice. -->
  {#if searchOpen && LocationDialog}<LocationDialog {project} presets={PRESETS} onChoose={choosePlace} onCoordinates={(lat, lon) => updateLocation({ lat, lon, label: "Custom coordinates" })} onClose={closeLocationDialog} />{/if}
{/snippet}

{#if embeddedInPlatform}
  {#if AtommWorkbench}<AtommWorkbench ready={atommReady} blockedReason={previewBusy ? undefined : activeSource.sourceKind !== "real" || terrainDataStale ? "Export is available once the terrain for this area has loaded." : exportBlockedBy} preparing={exportPhase === "preparing"} {exportPhase} {exportTitle} {exportDetail}>
    {#snippet leadHeader()}<ProjectControls />{/snippet}
    {#snippet lead()}<OutputSwitch />{#if mode === "custom"}{@render customDataTools()}{:else}<SetupSection /><CustomDataSection />{/if}{/snippet}
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
      <ContextBar class="terrain-contextbar" section="Terrain" title={project.location.label.split(",")[0] ?? project.location.label} detail={project.location.label.split(",").slice(1).join(",") || "Selected coordinates"}>
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
          {@render customDataTools()}
        {:else}
          <div class="panel-intro">
            <span class="section-kicker panel-eyebrow">Project controls</span>
            <h1>{project.outputMode === "engraving" ? "Draw the landscape." : "Build the landscape."}</h1>
            <p>Work through the essentials, then open details only when you need them.</p>
            <div class="section-tools" aria-label="Section display controls">
              <button type="button" onclick={() => setAllSections(true)} disabled={shownSections.every((section) => menuSections.open[section])}>Expand all</button>
              <button type="button" onclick={() => setAllSections(false)} disabled={shownSections.every((section) => !menuSections.open[section])}>Collapse all</button>
            </div>
          </div>
          {#if starterId && project.id === `topostack-starter-${starterId}`}<StarterSteps id={starterId} ready={exportReady} busy={previewBusy} exported={exportedFingerprint === projectFingerprint(project)} onGenerate={() => void generate()} onExport={() => exportOpen = true} onDismiss={() => starterId = undefined} />{/if}
          <SetupSection />

          <ParameterSections />
        {/if}
      </div>
      {#if mode !== "custom"}<GenerationDock />{/if}
    </Sidebar>
    {/snippet}

    <PreviewPanel />
  </Workspace>
  <ExportDialog open={exportOpen} {project} summary={outputSummary.join(" · ")} panelCount={fabricationPanelCount} nested={Boolean(sheetNesting.exportPlan)} acrylicCount={acrylicPanelTotal} acrylicNested={Boolean(acrylicSheetNesting.exportPlan)} blockedReason={exportBlockedBy} preparing={exportPhase === "preparing"} phase={exportPhase} title={exportTitle} detail={exportDetail} onDownload={(option) => void downloadProject(option)} onClose={() => exportOpen = false} onSavePreview={() => void savePreviewImage()} onCopyLink={() => void copyShareLink()} onShare={() => void shareDesign()} {previewImageBusy} {previewImageStatus}>
    {#snippet sheetLayout()}<SheetLayoutSection disabled={Boolean(exportBlockedBy)} />{#if geometry.waterInserts?.length}<SheetLayoutSection material="acrylic" disabled={Boolean(exportBlockedBy)} />{/if}{/snippet}
  </ExportDialog>
  {@render locationSearch()}
</AppShell>

{/if}

{#if resetOpen}<ResetProjectDialog onConfirm={() => { resetOpen = false; resetProject(); }} onClose={() => resetOpen = false} />{/if}
