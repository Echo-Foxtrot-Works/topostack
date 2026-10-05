<script lang="ts">
  import SvgViewport from "$lib/studio/SvgViewport.svelte";
  import { tick } from "svelte";
  import { openCustomDataSection } from "$lib/studio/customdata/custom-data-nav.svelte";
  import { ImageUp, MapPin } from "@lucide/svelte";
  import { CHART_UNIT_METRES } from "@topostack/data-contracts/chart-bathymetry";
  import ChartContourReview from "./ChartContourReview.svelte";
  import { draft } from "$lib/studio/customdata/chart-draft.svelte";
  import { paintChart, paintDepthPreview, resultIsCurrent, session, unitLabel } from "$lib/studio/customdata/chart-tracing.svelte";

  let canvas = $state<HTMLCanvasElement | undefined>();
  let previewCanvas = $state<HTMLCanvasElement | undefined>();

  async function reviewAndSave(): Promise<void> {
    openCustomDataSection("charts");
    await tick();
    const heading = document.getElementById("chart-save-heading");
    heading?.focus();
    heading?.scrollIntoView({ block: "nearest" });
  }

  let threeUnavailable = $state(false);
  $effect(() => { if (draft.image && canvas) paintChart(canvas); });
  $effect(() => { if (draft.result && previewCanvas) paintDepthPreview(previewCanvas); });
</script>

{#snippet depthPreviews()}
    <div class="chart-result">
      <section class="chart-result__visual chart-result__3d" aria-label="3D lake bed">
        <h3 class="chart-result__title">3D lake bed</h3>
        {#if draft.result && !resultIsCurrent()}
          <p class="chart-warning" role="status">Preview out of date. Correct any review issues, then generate reviewed depths again.</p>
        {/if}
        <div class="chart-3d-slot">
        {#if draft.result}
          {#if !threeUnavailable}
            {#await import("./ChartDepth3D.svelte")}
              <p class="chart-preview-placeholder" role="status">Loading 3D lake bed…</p>
            {:then module}
              {#key draft.result}
                <module.default grid={draft.result.record.grid} onUnavailable={() => { threeUnavailable = true; }} />
              {/key}
            {:catch}
              <p class="chart-preview-placeholder" role="status">3D preview could not load. Inspect the flat DEM below.</p>
            {/await}
          {:else}
            <p class="chart-preview-placeholder" role="status">3D preview is unavailable. Inspect the flat DEM below.</p>
          {/if}
        {:else}
          <p class="chart-preview-placeholder">Review contours and alignment, then generate depths to inspect the lake bed.</p>
        {/if}
        </div>
      </section>
      <section class="chart-result__visual chart-result__dem" aria-label="Flat DEM">
        <h3 class="chart-result__title">Flat DEM <small>North up</small></h3>
        <figure class="chart-preview-figure" aria-label="Traced lake bed, shaded from shallow to deep">
          <div class="chart-dem-slot">
          {#if draft.result}
            <canvas bind:this={previewCanvas} class="chart-preview" aria-hidden="true"></canvas>
          {:else}
            <p class="chart-preview-placeholder">The generated depth map will appear here.</p>
          {/if}
          </div>
          <figcaption class="chart-preview-legend"><span>Shallow</span><span>Deep</span></figcaption>
        </figure>
        {#if draft.result}
        <div class="chart-result__read">
          <h3 class="ldt-visually-hidden">{resultIsCurrent() ? "Your traced lake bed" : "Previous trace"}</h3>
          <dl class="chart-report">
            <div><dt>Deepest</dt><dd>{(draft.result.report.deepestM / CHART_UNIT_METRES[draft.units]).toFixed(1)} {unitLabel(draft.units)}</dd></div>
            <div><dt>Contours levelled</dt><dd>{Math.round(draft.result.report.coverage * 100)}%</dd></div>
            <div><dt>Fit to the lake's shape</dt><dd>{Math.round(draft.result.report.iou * 100)}%</dd></div>
          </dl>
          {#if !resultIsCurrent()}
            <p class="chart-warning" role="status">Changed since generation. Resolve review issues and generate reviewed depths again.</p>
          {/if}
          {#if resultIsCurrent() && draft.result.report.ambiguous}
            <p class="chart-warning" role="status">This lake fits the chart more than one way. Compare the lake bed with the chart; if it is turned, choose Try another placement.</p>
          {/if}
          {#if draft.result.report.snapUncertain}
            <p class="chart-warning" role="alert">The chart's shape does not match this lake closely. Check the preview against the lake, or try a straighter picture.</p>
          {/if}
          {#if resultIsCurrent()}<button type="button" class="chart-review-save" onclick={() => void reviewAndSave()}>Review and save chart</button>{/if}
          {#if draft.result.report.coverage < 1}
            <p class="chart-warning" role="status">Some contours carry no depth. Placing another depth usually fixes the rest.</p>
          {/if}
        </div>
        {/if}
      </section>
    </div>
{/snippet}

<div class="chart-stage">
  {#if !draft.lake}
    <div class="chart-stage__empty">
      <MapPin size={28} aria-hidden="true" />
      <h2>Turn a depth chart into a lake bed</h2>
      <p>Start in the sidebar: search for the lake this chart shows.</p>
      <ol><li>Choose a lake and upload its chart.</li><li>Prepare contours, then define each path.</li><li>Repair and confirm the paths, align the chart, then generate and review depths.</li></ol>
      <small>Use a saved chart for its lake, then regenerate terrain to apply it.</small>
    </div>
  {:else if !draft.image}
    <p class="chart-stage__empty"><ImageUp size={20} />Choose a picture of {draft.lake.name}'s chart in the sidebar: a scan, a photo or a screenshot. Straight-on works best.</p>
  {:else if draft.review}
    {#key draft.reviewRevision}<ChartContourReview previews={depthPreviews} />{/key}
  {:else}
    <div class="chart-workspace">
    <section class="chart-editor" aria-label="Chart editor">
    <h3 class="chart-result__title">Chart editor</h3>
    <figure class="chart-figure">
      <div class="chart-image-area" style:--chart-aspect={draft.image.width / draft.image.height}>
      {#key draft.image}
      <SvgViewport widthMm={draft.image.width} heightMm={draft.image.height} topLeft padding={0} label="source chart" svgLabel="Source chart" controlsLabel="Source chart zoom controls" resetLabel="Reset source chart view">
        <foreignObject width={draft.image.width} height={draft.image.height}>
          <canvas bind:this={canvas} width={draft.image.width} height={draft.image.height} class="chart-canvas" aria-label={`${draft.lake.name} source chart`}></canvas>
        </foreignObject>
      </SvgViewport>
      {/key}
      </div>
      <figcaption class="chart-hint">Choose Prepare contours for review in the sidebar to begin. Scroll or pinch to inspect the source.</figcaption>
    </figure>

    {#if session.error}<p class="chart-error" role="alert">{session.error}</p>{/if}

    </section>
    {@render depthPreviews()}
    </div>
  {/if}
</div>
