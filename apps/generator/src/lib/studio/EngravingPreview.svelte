<script lang="ts">
  import SvgViewport from "$lib/studio/SvgViewport.svelte";
  import { cropRadiusMm, waterPatternStrokes, type GeometryIRV1, type Point2D, type ProjectConfigV1 } from "@topostack/core";
  import { markingDash, markingWidth } from "$lib/studio/marking-style";
  import { labelPaths, markingPath, pointsToPath as linePath } from "$lib/studio/svg-path";

  // `cropShape` comes from the project the geometry was built for: a width,
  // height or shape edit leaves the map area stale, so drawing the surface and
  // border from the live project would frame old contours at the new size and
  // stop `onBoundary` recognizing the crop edges it clipped them to.
  let { geometry, project, cropShape }: { geometry: GeometryIRV1; project: ProjectConfigV1; cropShape: ProjectConfigV1["cropShape"] } = $props();
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
  const markings = $derived(layers.flatMap((layer) => layer.markings)
    .filter((marking) => !marking.id.startsWith("alignment-")));
  function onBoundary(start: Point2D, end: Point2D): boolean {
    const epsilon = 0.02;
    if (crop.cropShape === "circle") {
      const radius = cropRadiusMm(crop);
      return Math.abs(Math.hypot(start.x, start.y) - radius) <= epsilon &&
        Math.abs(Math.hypot(end.x, end.y) - radius) <= epsilon;
    }
    const halfWidth = crop.widthMm / 2;
    const halfHeight = crop.heightMm / 2;
    return (Math.abs(start.x - halfWidth) <= epsilon && Math.abs(end.x - halfWidth) <= epsilon) ||
      (Math.abs(start.x + halfWidth) <= epsilon && Math.abs(end.x + halfWidth) <= epsilon) ||
      (Math.abs(start.y - halfHeight) <= epsilon && Math.abs(end.y - halfHeight) <= epsilon) ||
      (Math.abs(start.y + halfHeight) <= epsilon && Math.abs(end.y + halfHeight) <= epsilon);
  }

  function contourPath(points: Point2D[]): string {
    let result = "";
    let connected = false;
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1]!;
      const end = points[index]!;
      if (onBoundary(start, end)) { connected = false; continue; }
      if (!connected) result += `M${start.x} ${start.y}`;
      result += `L${end.x} ${end.y}`;
      connected = true;
    }
    return result;
  }

</script>

<div class="engraving-stage">
  <SvgViewport widthMm={geometry.widthMm} heightMm={geometry.heightMm} label="engraving" svgLabel="Flat engraving preview" controlsLabel="Engraving zoom controls" resetLabel="Reset engraving view">
    <defs><filter id="engraving-shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.2" /></filter></defs>
    {#if crop.cropShape === "circle"}
      <circle cx="0" cy="0" r={cropRadiusMm(crop)} class="engraving-surface" data-preview-shadow filter="url(#engraving-shadow)" />
    {:else}
      <rect x={-crop.widthMm / 2} y={-crop.heightMm / 2} width={crop.widthMm} height={crop.heightMm} class="engraving-surface" data-preview-shadow filter="url(#engraving-shadow)" />
    {/if}
    {#if waterPattern.length}
      <g class="engraving-water-pattern" data-water-pattern={project.waterFillPattern} stroke-width={geometry.lineStyle.waterMm}>
        {#each waterPattern as points, index (index)}<path d={linePath(points)} />{/each}
      </g>
    {/if}
    <g class="engraving-contours">
      {#each contourLayers as layer}
        {#each layer.polygons as polygon}
          {#each [polygon.outer, ...polygon.holes] as ring}
            <path d={contourPath(ring)} stroke-width={layer.index % project.engravingIndexInterval === 0 ? geometry.lineStyle.indexContourMm : geometry.lineStyle.contourMm} class:index-contour={layer.index % project.engravingIndexInterval === 0} />
          {/each}
        {/each}
      {/each}
    </g>
    <g class="engraving-details">
      {#each markings as marking (marking.id)}
        <g data-marking-id={marking.id} data-marking-kind={marking.kind} data-transportation-class={marking.transportationClass}>
          {#if marking.points.length > 1}<path d={markingPath(marking)} fill-rule="evenodd" fill={marking.knockout ? "#e8cfaa" : marking.filled ? "#2b2119" : "none"} stroke={marking.filled ? "none" : undefined} stroke-width={markingWidth(marking, geometry.lineStyle)} stroke-dasharray={markingDash(marking, geometry.lineStyle)} stroke-linecap={marking.kind === "road" ? geometry.lineStyle.roadCap : undefined} stroke-linejoin={marking.kind === "road" ? "round" : undefined} />{/if}
          {#if marking.label && marking.points[0]}{@const text = labelPaths(marking)}{#if text.fill}<path d={text.fill} fill-rule="evenodd" fill="#2b2119" stroke="none" />{:else}<path d={text.stroke} stroke-width={geometry.lineStyle.annotationMm} stroke-linecap={text.round ? "round" : "butt"} stroke-linejoin={text.round ? "round" : "miter"} />{/if}{/if}
        </g>
      {/each}
    </g>
    {#if project.showEngravingBorder}
      {#if crop.cropShape === "circle"}<circle cx="0" cy="0" r={cropRadiusMm(crop)} class="engraving-border" stroke-width={geometry.lineStyle.borderMm} />{:else}<rect x={-crop.widthMm / 2} y={-crop.heightMm / 2} width={crop.widthMm} height={crop.heightMm} class="engraving-border" stroke-width={geometry.lineStyle.borderMm} />{/if}
    {/if}
  </SvgViewport>
  <div class="engraving-legend">{#if project.showEngravingContours}<span><i style:--sample-width={`${Math.max(1, geometry.lineStyle.contourMm * 5)}px`}></i> Minor contour</span><span><i class="index" style:--sample-width={`${Math.max(1, geometry.lineStyle.indexContourMm * 5)}px`}></i> Index every {project.engravingIndexInterval}</span><span>{project.engravingContourCount} contours</span>{:else}<span>No contours</span>{/if}{#if project.showWater && project.waterFillPattern !== "none"}<span>{project.waterFillPattern} water</span>{/if}</div>
</div>
