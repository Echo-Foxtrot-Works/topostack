<script lang="ts">
  import { cropRadiusMm, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";
  import { markingColor, markingDash, markingWidth } from "$lib/studio/marking-style";
  import { labelPaths, markingPath, pointsToPath } from "$lib/studio/svg-path";
  import { hiddenByPrefix } from "./placeables";
  import { placementViewBox } from "./viewport";

  /**
   * The finished piece seen from above without WebGL: every sheet painted
   * bottom to top, so each shows only where the sheets above leave it
   * exposed, with its markings. Flat engravings draw their one sheet with the
   * contour lines on it. The fallback backdrop for placement mode.
   */
  let { geometry, outputMode, cropShape, marginMm, hiddenPrefixes, bare = false }: {
    geometry: GeometryIRV1;
    outputMode: ProjectConfigV1["outputMode"];
    cropShape: ProjectConfigV1["cropShape"];
    marginMm: number;
    hiddenPrefixes: readonly string[];
    bare?: boolean;
  } = $props();

  const viewBox = $derived(placementViewBox(geometry.widthMm, geometry.heightMm, marginMm));
  const ringsPath = (polygon: GeometryIRV1["layers"][number]["polygons"][number]) => [polygon.outer, ...polygon.holes].map((ring) => `${pointsToPath(ring)} Z`).join(" ");
  const layers = $derived(geometry.layers.map((layer, index) => ({
    layer,
    // Higher sheets read lighter, as they catch more light on the finished piece.
    shade: `color-mix(in srgb, #f3dcb4 ${Math.round(35 + 65 * index / Math.max(1, geometry.layers.length - 1))}%, #b98a55)`,
    // Detail engraved on an acrylic insert reads on the water it covers.
    markings: [...layer.markings, ...(geometry.waterInserts ?? []).filter((insert) => insert.layerIndex === index).flatMap((insert) => insert.markings)]
      .filter((marking) => !hiddenByPrefix(marking.id, hiddenPrefixes) && !marking.id.startsWith("alignment-")),
  })));
</script>

<svg class="stack-top-view" viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`} role="img" aria-label="Top-down view of the piece">
  {#if outputMode === "engraving"}
    {#if cropShape === "circle"}<circle cx="0" cy="0" r={cropRadiusMm(geometry)} fill="#e8cfaa" />{:else}<rect x={-geometry.widthMm / 2} y={-geometry.heightMm / 2} width={geometry.widthMm} height={geometry.heightMm} fill="#e8cfaa" />{/if}
    {#if !bare}<g fill="none" stroke="#6b4a2d" stroke-width={geometry.lineStyle.contourMm}>
      {#each geometry.layers.slice(1) as layer (layer.id)}
        {#each layer.polygons as polygon}<path d={ringsPath(polygon)} />{/each}
      {/each}
    </g>{/if}
  {/if}
  {#each layers as { layer, shade, markings } (layer.id)}
    {#if outputMode === "stack"}
      {#each layer.polygons as polygon}<path d={ringsPath(polygon)} fill={shade} fill-rule="evenodd" stroke="#8a5a32" stroke-width="0.3" />{/each}
      {#each (geometry.waterSurfaces ?? []).filter((surface) => surface.layerIndex === layer.index) as surface (surface.id)}
        {#each surface.polygons as polygon}<path d={ringsPath(polygon)} fill="#5f97b5" fill-opacity="0.6" fill-rule="evenodd" />{/each}
      {/each}
    {/if}
    {#each markings as marking (marking.id)}
      {#if marking.label && marking.points[0]}
        {@const text = labelPaths(marking)}
        {#if text.fill}<path d={text.fill} fill-rule="evenodd" fill={markingColor(marking)} />{:else}<path d={text.stroke} fill="none" stroke={markingColor(marking)} stroke-width={geometry.lineStyle.annotationMm} />{/if}
      {:else if marking.points.length > 1}
        <path d={markingPath(marking)} fill-rule="evenodd" fill={marking.knockout ? shade : marking.filled ? markingColor(marking) : "none"} stroke={marking.filled ? "none" : markingColor(marking)} stroke-width={markingWidth(marking, geometry.lineStyle)} stroke-dasharray={markingDash(marking, geometry.lineStyle)} />
      {/if}
    {/each}
  {/each}
</svg>
