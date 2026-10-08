<script lang="ts">
  import GenerationProgress from "$lib/studio/GenerationProgress.svelte";
  import { base } from "$app/paths";
  import { Box, FileOutput, Layers3, Map as MapIcon, PenTool, Waves, X } from "@lucide/svelte";
  import { Button } from "@loidolt/theme-svelte";
  import { displayElevation } from "@topostack/core";
  import FeedbackButton from "$lib/site/FeedbackButton.svelte";
  import { featuredLayerIndex } from "$lib/studio/preview-summary";
  import LakeDepthHelp from "$lib/studio/panels/LakeDepthHelp.svelte";
  import LayerDock from "$lib/studio/panels/LayerDock.svelte";
  import MapStage from "$lib/studio/MapStage.svelte";
  import { MAP_DATA_ATTRIBUTION } from "$lib/domain/map-attribution";
  import { getStudio, type PreviewMode } from "$lib/studio/studio-context";
  import PlaceGraphicsButton from "$lib/studio/customdata/PlaceGraphicsButton.svelte";

  let { openLakeDepthHelp }: { openLakeDepthHelp?: (trigger: HTMLButtonElement) => void } = $props();
  const studio = getStudio();
  // Lazily loaded previews are rendered as tags, which need a local binding.
  const EngravingPreview = $derived(studio.EngravingPreview);
  const TwoDPreview = $derived(studio.TwoDPreview);
  const PlacementStage = $derived(studio.PlacementStage);
  const ThreePreview = $derived(studio.ThreePreview);
  const CustomDataView = $derived(studio.CustomDataView);
  const ExportPreview = $derived(studio.ExportPreview);
  const { cancelGeneration, cancelPlacement, commitPlacement, dismissPreviewWarning, getFeedbackContext, navigateChoice, shownLength, updateFabrication } = studio;
  const keyboardView = $derived(studio.previewModeOptions.find(option => option.value === studio.mode)?.value ?? studio.previewModeOptions[0]?.value);
  function choosePreviewMode(value: string): void {
    if (value === "2d" && studio.selectedLayer === 0) studio.selectedLayer = featuredLayerIndex(studio.geometry);
    studio.previewNotice = "";
    if (value === "3d") studio.threeUnavailable = false;
    studio.mode = value as PreviewMode;
  }
  function mapUnavailable(reason?: "unsupported" | "load-failed"): void {
    studio.mode = studio.project.outputMode === "engraving" ? "engraving" : "2d";
    studio.previewNotice = reason === "load-failed" ? "Map could not load · check your connection or choose a location using search or coordinates" : "Map is unavailable in this browser · choose a location using search or coordinates";
  }
  function threeUnavailable(): void {
    studio.threeUnavailable = true;
    studio.mode = "2d";
    studio.previewNotice = "3D is unavailable in this browser · showing cut layers";
  }
  /** While placing over the 3D preview, what it hides and how it frames the model. */
  const threePlacement = $derived(studio.placementBackdrop === "3d" ? { hiddenPrefixes: studio.placementPhase === "closing" ? [] : studio.placementHiddenPrefixes, marginMm: studio.placementMargin, hideMarkings: studio.placementPhase !== "closing", toolbarRows: studio.project.customGraphics?.length ? 2 : 1 } : undefined);
  const OSM_ATTRIBUTION = MAP_DATA_ATTRIBUTION.find((entry) => entry.name === "OpenStreetMap contributors") ?? { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright" };
</script>

<section class="preview-panel" class:engraving-preview-panel={studio.project.outputMode === "engraving"}>
  <div class="preview-toolbar">
    <div class="ldt-toggle-group mode-switch" role="radiogroup" aria-label="Preview mode">
      {#each studio.previewModeOptions as option}
        <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.mode === option.value} data-state={studio.mode === option.value ? "on" : "off"} tabindex={keyboardView === option.value ? 0 : -1} onclick={() => choosePreviewMode(option.value)} onkeydown={navigateChoice}>{#if option.value === "map"}<MapIcon size={15} />{:else if option.value === "engraving"}<PenTool size={15} />{:else if option.value === "2d"}<Layers3 size={15} />{:else if option.value === "custom"}<Waves size={15} />{:else if option.value === "export"}<FileOutput size={15} />{:else}<Box size={15} />{/if}{option.label}</button>
      {/each}
    </div>
    <div class="preview-readout">
      <span>{shownLength(studio.project.widthMm)} × {shownLength(studio.project.heightMm)} {studio.shownLengthUnit}</span>
      {#if !studio.embeddedInPlatform}<span class="output-summary">{#each studio.outputSummary as item}<span>{item}</span>{/each}</span>{/if}
      <span>{Math.round(displayElevation(studio.geometry.minElevationM, studio.project.units)).toLocaleString()}–{Math.round(displayElevation(studio.geometry.maxElevationM, studio.project.units)).toLocaleString()} {studio.shownElevationUnit}</span>
    </div>
  </div>
  <div class="preview-stage" aria-busy={studio.previewBusy} data-placement-graphics={studio.project.customGraphics?.length ? "" : undefined} data-placement-fade={studio.placementFade || undefined}
    data-road-markings={studio.detailCounts.road} data-trail-markings={studio.detailCounts.trail} data-transportation-label-markings={studio.detailCounts.transportationLabel} data-water-markings={studio.detailCounts.water} data-contour-markings={studio.detailCounts.contour} data-alignment-markings={studio.detailCounts.alignment} data-elevation-markings={studio.detailCounts.elevation}
    data-north-markings={studio.detailCounts.north} data-scale-markings={studio.detailCounts.scale} data-plaque-markings={studio.detailCounts.plaque} data-marker-markings={studio.detailCounts.marker} data-custom-line-markings={studio.detailCounts.customLine} data-aviation-markings={studio.detailCounts.aviation} data-aviation-label-markings={studio.detailCounts.aviationLabel}>
    {#if !studio.embeddedInPlatform}<FeedbackButton edge getContext={getFeedbackContext} />{/if}
    {#if studio.mode === "map" && studio.placementBackdrop !== "3d"}
      <MapStage onUnavailable={mapUnavailable} />
    {:else if studio.mode === "engraving" && studio.placementBackdrop !== "3d"}
      {#if studio.EngravingPreview}<EngravingPreview geometry={studio.geometry} project={studio.project} cropShape={studio.sourceProject.cropShape} />
      {:else if studio.engravingPreview.failed}<div class="preview-loading preview-load-failed" role="alert">Engraving preview could not load<button type="button" class="btn btn-secondary" onclick={() => studio.engravingPreview.load()}>Retry</button></div>
      {:else}<div class="preview-loading">Loading engraving…</div>{/if}
    {:else if studio.mode === "custom" && studio.placementBackdrop !== "3d"}
      {#if CustomDataView}<CustomDataView />
      {:else if studio.customDataView.failed}<div class="preview-loading preview-load-failed" role="alert">Custom data could not load<button type="button" class="btn btn-secondary" onclick={() => studio.customDataView.load()}>Retry</button></div>
      {:else}<div class="preview-loading">Loading custom data…</div>{/if}
    {:else if studio.mode === "export" && studio.placementBackdrop !== "3d"}
      {#if ExportPreview}<ExportPreview geometry={studio.geometry} project={studio.project} blocked={studio.exportBlockedBy} busy={studio.previewBusy} />
      {:else if studio.exportPreview.failed}<div class="preview-loading preview-load-failed" role="alert">Export preview could not load<button type="button" class="btn btn-secondary" onclick={() => studio.exportPreview.load()}>Retry</button></div>
      {:else}<div class="preview-loading">Loading export preview…</div>{/if}
    {:else if studio.mode === "2d" && studio.placementBackdrop !== "3d"}
      {#if studio.TwoDPreview}<TwoDPreview geometry={studio.geometry} selectedLayer={studio.selectedLayer} />
      {:else if studio.twoDPreview.failed}<div class="preview-loading preview-load-failed" role="alert">Cut preview could not load<button type="button" class="btn btn-secondary" onclick={() => studio.twoDPreview.load()}>Retry</button></div>
      {:else}<div class="preview-loading">Loading cut preview…</div>{/if}
    {:else if studio.ThreePreview}
      <ThreePreview geometry={studio.geometry} exploded={studio.explodedPreview} placement={threePlacement} onUnavailable={threeUnavailable} />
    {:else}
      <div class="preview-loading">Loading 3D preview…</div>
    {/if}
    {#if studio.placementBackdrop && PlacementStage && (studio.placementBackdrop === "flat" || studio.ThreePreview)}
      <PlacementStage backdrop={studio.placementBackdrop} phase={studio.placementPhase} geometry={studio.geometry} project={studio.project} cropShape={studio.sourceProject.cropShape} session={studio.placement!} marginMm={studio.placementMargin} hiddenPrefixes={studio.placementHiddenPrefixes} onChange={(session) => { studio.placement = session; }} onDone={commitPlacement} onCancel={cancelPlacement} />
    {/if}
    {#if studio.mode === "3d" || studio.mode === "engraving"}<PlaceGraphicsButton />{/if}
    {#if studio.mode !== "map" && studio.mode !== "custom"}
      <div class="preview-attribution">Map data © <a href={OSM_ATTRIBUTION.url} target="_blank" rel="noreferrer">{OSM_ATTRIBUTION.name}</a> · <a href={`${base}/attribution${import.meta.env.VITE_SITE_ENV === "atomm" ? ".html" : ""}`} target="_blank" rel="noopener noreferrer">All sources<span class="ldt-visually-hidden"> (opens in a new tab)</span></a></div>
    {/if}
    {#if studio.previewBusy && studio.mode !== "custom"}
      <GenerationProgress compact={studio.detailsUpdating && studio.generationState !== "loading" && (!studio.terrainRefreshing || studio.mode === "map")} passive={studio.detailsUpdating && studio.generationState !== "loading"} title={studio.previewBusyLabel} detail={studio.status} step={studio.generationState === "loading" ? studio.generationStep : undefined} onCancel={studio.embeddedInPlatform && (studio.generationState === "loading" || (studio.terrainRefreshing && studio.mode !== "map")) ? cancelGeneration : undefined} cancelLabel={studio.generationState === "loading" ? "Cancel generation" : "Cancel"} />
    {/if}
    {#if studio.mode !== "custom" && studio.mode !== "export" && (studio.visibleWarnings.length || studio.previewNotice || studio.lakeDepthFittingOn)}
      <div class="warning-stack">
        {#if studio.lakeDepthFittingOn}
          <div class="preview-warning preview-notice" role="status">
            <span class="warning-icon" aria-hidden="true"><Waves size={12} /></span>
            <p>Lake depth fitting is on. <Button class="warning-action" disabled={studio.previewBusy} onclick={() => void updateFabrication({ fitLakeDepth: false })}>Use manual depth</Button></p>
          </div>
        {/if}
        {#if studio.previewNotice}
          <div class="preview-warning preview-notice" role="status">
            <span class="warning-icon" aria-hidden="true">!</span>
            <p>{studio.previewNotice}</p>
            <button type="button" class="warning-dismiss" aria-label={`Dismiss notice: ${studio.previewNotice}`} title="Dismiss notice" onclick={(event) => dismissPreviewWarning(event)}><X size={14} aria-hidden="true" /></button>
          </div>
        {/if}
        {#each studio.visibleWarnings as warning (`${warning.code}-${warning.message}`)}
          <div class="preview-warning">
            <span class="warning-icon" aria-hidden="true">!</span>
            <p>{warning.message}{#if warning.code === "LAKE_DEPTH_PREDICTED"}&nbsp;<LakeDepthHelp {openLakeDepthHelp} />{/if}{#if warning.action === "fit-lake-depth" && !studio.project.fitLakeDepth} <Button class="warning-action" disabled={studio.previewBusy} onclick={() => void updateFabrication({ fitLakeDepth: true })}>Fit depth</Button>{/if}</p>
            <button type="button" class="warning-dismiss" aria-label={`Dismiss warning: ${warning.message}`} title="Dismiss warning" onclick={(event) => dismissPreviewWarning(event, `${warning.code}-${warning.message}`)}><X size={14} aria-hidden="true" /></button>
          </div>
        {/each}
      </div>
    {/if}</div>
  {#if !studio.embeddedInPlatform && studio.mode !== "custom"}<LayerDock />{/if}
</section>
