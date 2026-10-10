<script lang="ts">
  import { draft } from "$lib/studio/customdata/chart-draft.svelte";
  import { picker, mapLakes, loadVisibleLakes, lakeMapTargets, pickLakeOnMap, cancelLakePicker } from "$lib/studio/customdata/lake-picker.svelte";
  import { onDestroy, untrack } from "svelte";
  import { nav, sectionsFor } from "$lib/studio/customdata/custom-data-nav.svelte";
  import { disposeTracer } from "$lib/studio/customdata/chart-tracing.svelte";
  import ChartCanvas from "$lib/studio/customdata/ChartCanvas.svelte";
  import MapStage from "$lib/studio/MapStage.svelte";
  import PlaceGraphicsButton from "$lib/studio/customdata/PlaceGraphicsButton.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * The workspace for data the maker brings: whatever the open sidebar section
   * works on. A depth chart is a picture to click; markers, paths and an
   * import all land on the map, so they share it. Graphics sit on the piece
   * rather than the ground, so they show the piece.
   *
   * The trace worker outlives no view: the draft survives leaving this one,
   * but the worker is started again on the next trace.
   */

  onDestroy(() => { disposeTracer(); cancelLakePicker(); });
  $effect(() => { if (draft.image || nav.section !== "charts") cancelLakePicker(); });
  const studio = getStudio();
  // Keep feedback from custom-data actions after removing the terrain dock.
  // Do not bring the previous terrain status into this workspace on entry.
  let previousStatus = untrack(() => studio.status);
  let notice = $state("");
  $effect(() => {
    const status = studio.status;
    if (status !== previousStatus) { previousStatus = status; notice = status; }
  });
  const section = $derived(sectionsFor(studio.project.outputMode).find((section) => section.id === nav.section));
</script>

<div class="custom-data-view">
  <div class="custom-data-workspace-heading">
    <strong>{section?.label}</strong>
    <span>{nav.section === "charts" ? "Trace a chart to shape a lake bed" : nav.section === "markers" ? "Mark places that matter" : nav.section === "paths" ? "Draw trails and boundaries" : nav.section === "graphics" ? "Place logos and artwork on your piece" : "Bring tracks and places onto your map"}</span>
  </div>
  <div class="custom-data-workspace-stage">
  {#if nav.section === "charts" && studio.project.outputMode !== "engraving"}
    {#if draft.image}
      <ChartCanvas />
    {:else}
      <div class="chart-lake-map">
        <div class="chart-lake-map__guide" role="status">
          <strong>{draft.lake ? draft.lake.name : "Choose the lake your chart shows"}</strong>
          <span>{picker.searching ? picker.status : draft.lake ? "Lake selected. Upload its chart in the tools to continue, or click another lake." : "Hover over an outlined lake, then click to select it. Pan the map or search to find another lake."}</span>
          {#if mapLakes.loading}<span>Finding lakes in this view…</span>{:else if mapLakes.note}<span>{mapLakes.note}</span>{/if}
          {#if picker.error}<p class="chart-error" role="alert">{picker.error}</p>{/if}
        </div>
        <MapStage lakeSelection={{ bounds: picker.bounds, activeId: picker.activeId, lakes: lakeMapTargets() }} onLakeViewportChange={(bounds) => void loadVisibleLakes(bounds)} onLakeMapClick={(lat, lon, lakeId) => void pickLakeOnMap(lat, lon, lakeId)} />
      </div>
    {/if}
  {:else if nav.section === "graphics"}
    {#if studio.project.outputMode === "stack" && !studio.threeUnavailable}
      {#if studio.ThreePreview}
        {@const Three = studio.ThreePreview}
        <Three geometry={studio.geometry} exploded={studio.explodedPreview} onUnavailable={() => { studio.threeUnavailable = true; }} />
      {:else}<div class="preview-loading">Loading 3D preview…</div>{/if}
    {:else if studio.project.outputMode === "engraving"}
      {#if studio.EngravingPreview}
        {@const Engraving = studio.EngravingPreview}
        <Engraving geometry={studio.geometry} project={studio.project} cropShape={studio.sourceProject.cropShape} />
      {:else}<div class="preview-loading">Loading engraving…</div>{/if}
    {:else if studio.TwoDPreview}
      {@const TwoD = studio.TwoDPreview}
      <TwoD geometry={studio.geometry} selectedLayer={studio.selectedLayer} />
    {:else}<div class="preview-loading">Loading cut preview…</div>{/if}
    <PlaceGraphicsButton />
  {:else}
    <MapStage />
  {/if}
  </div>
  {#if notice}<p class="custom-data-notice" role="status">{notice}</p>{/if}
</div>
