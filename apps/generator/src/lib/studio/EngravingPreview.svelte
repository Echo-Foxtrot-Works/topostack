<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte";
  import SvgViewport from "$lib/studio/SvgViewport.svelte";
  import { SCORE_BURN_WIDTH_MM, cropRadiusMm, flatArtworkMarkings, openContourPath, waterPatternStrokes, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";
  import { markingCap, markingDash } from "$lib/studio/marking-style";
  import { labelPaths, markingPath, pointsToPath as linePath } from "$lib/studio/svg-path";
  import { placementViewBox } from "$lib/studio/placement/viewport";

  // `cropShape` comes from the project the geometry was built for: a width,
  // height or shape edit leaves the map area stale, so drawing the surface and
  // border from the live project would frame old contours at the new size and
  // stop `openContourPath` recognizing the crop edges it clipped them to.
  let { geometry, project, cropShape, artworkOnly = false }: { geometry: GeometryIRV1; project: ProjectConfigV1; cropShape: ProjectConfigV1["cropShape"]; artworkOnly?: boolean } = $props();
  const shadowId = $props.id();
  // A rename or slider tick replaces `project` and `geometry` without changing
  // any of these, so reading them through narrow derivations keeps polygon
  // clipping and path building out of every keystroke.
  const widthMm = $derived(geometry.widthMm);
  const heightMm = $derived(geometry.heightMm);
  const crop = $derived({ widthMm, heightMm, cropShape });
  const layers = $derived(geometry.layers);
  const waterFillPattern = $derived(project.waterFillPattern);
  const waterPatternAreas = $derived(geometry.waterPatternAreas);
  const lineStyle = $derived(geometry.lineStyle);
  const contourLayers = $derived(layers.slice(1));
  const waterPattern = $derived(waterPatternStrokes(waterFillPattern, waterPatternAreas, crop.widthMm, crop.heightMm, lineStyle.waterMm));
  const markings = $derived(flatArtworkMarkings(layers));
</script>

{#snippet artwork()}
    <defs><filter id={shadowId}><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.2" /></filter></defs>
    {#if crop.cropShape === "circle"}
      <circle cx="0" cy="0" r={cropRadiusMm(crop)} class="engraving-surface" data-preview-shadow filter={`url(#${shadowId})`} />
    {:else}
      <rect x={-crop.widthMm / 2} y={-crop.heightMm / 2} width={crop.widthMm} height={crop.heightMm} class="engraving-surface" data-preview-shadow filter={`url(#${shadowId})`} />
    {/if}
    {#if waterPattern.length}
      <g class="engraving-water-pattern" data-water-pattern={project.waterFillPattern} stroke-width={SCORE_BURN_WIDTH_MM}>
        {#each waterPattern as points, index (index)}<path d={linePath(points)} />{/each}
      </g>
    {/if}
    <g class="engraving-contours">
      {#each contourLayers as layer}
        {#each layer.polygons as polygon}
          {#each [polygon.outer, ...polygon.holes] as ring}
            <path d={openContourPath(ring, crop)} stroke-width={SCORE_BURN_WIDTH_MM} class:index-contour={layer.index % project.engravingIndexInterval === 0} />
          {/each}
        {/each}
      {/each}
    </g>
    <g class="engraving-details">
      {#each markings as marking (marking.id)}
        <g data-marking-id={marking.id} data-marking-kind={marking.kind} data-transportation-class={marking.transportationClass}>
          {#if marking.points.length > 1}<path d={markingPath(marking)} fill-rule="evenodd" fill={marking.knockout ? "#e8cfaa" : marking.filled ? "#2b2119" : "none"} stroke={marking.filled ? "none" : undefined} stroke-width={SCORE_BURN_WIDTH_MM} stroke-dasharray={markingDash(marking, geometry.lineStyle)} stroke-linecap={markingCap(marking, geometry.lineStyle)} stroke-linejoin={marking.kind === "road" ? "round" : undefined} />{/if}
          {#if marking.label && marking.points[0]}{@const text = labelPaths(marking)}{#if text.fill}<path d={text.fill} fill-rule="evenodd" fill="#2b2119" stroke="none" />{:else}<path d={text.stroke} stroke-width={SCORE_BURN_WIDTH_MM} stroke-linecap={text.round ? "round" : "butt"} stroke-linejoin={text.round ? "round" : "miter"} />{/if}{/if}
        </g>
      {/each}
    </g>
    {#if project.showEngravingBorder}
      {#if crop.cropShape === "circle"}<circle cx="0" cy="0" r={cropRadiusMm(crop)} class="engraving-border" stroke-width={SCORE_BURN_WIDTH_MM} />{:else}<rect x={-crop.widthMm / 2} y={-crop.heightMm / 2} width={crop.widthMm} height={crop.heightMm} class="engraving-border" stroke-width={SCORE_BURN_WIDTH_MM} />{/if}
    {/if}
{/snippet}

{#if artworkOnly}
  {@const box = placementViewBox(widthMm, heightMm, 5)}
  <svg class="stack-top-view" viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`} role="img" aria-label={t("preview.flatEngravingPreview")}>{@render artwork()}</svg>
{:else}
<div class="engraving-stage">
  <SvgViewport widthMm={geometry.widthMm} heightMm={geometry.heightMm} label="engraving" svgLabel={t("preview.flatEngravingPreview")} controlsLabel={t("preview.engravingZoomControls")} resetLabel={t("preview.resetEngravingView")}>{@render artwork()}</SvgViewport>
  <div class="engraving-legend">{#if project.showEngravingContours}<span>{t("preview.legendContourCount", { count: project.engravingContourCount })}</span>{:else}<span>{t("preview.legendNoContours")}</span>{/if}{#if project.showWater && project.waterFillPattern !== "none"}<span>{t("preview.legendWaterPattern", { pattern: project.waterFillPattern })}</span>{/if}</div>
</div>
{/if}
