<script lang="ts">
  import { cropRadiusMm, fittedWaterInsert, visibleMarkings, type GeometryIRV1, type OperationPath, type ProjectConfigV1 } from "@topostack/core";
  import { markingCap, markingColor, markingDash, markingWidth } from "$lib/studio/marking-style";
  import { labelPaths, markingPath, pointsToPath } from "$lib/studio/svg-path";
  import AirspaceLevelArtwork from "$lib/studio/AirspaceLevelArtwork.svelte";
  import { hiddenByPrefix } from "./placeables";
  import { placementViewBox } from "./viewport";
  import { t } from "$lib/i18n/i18n.svelte";

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
  function visible(markings: OperationPath[]) {
    return visibleMarkings(markings.filter(mark => !hiddenByPrefix(mark.id, hiddenPrefixes) && !mark.id.startsWith("alignment-")));
  }

  const faces = $derived.by(() => {
    const wood = geometry.layers.map((layer, index) => ({
      kind: "wood" as const,
      layer,
      id: layer.id,
      topMm: (layer.index + 1) * layer.materialThicknessMm,
      shade: `color-mix(in srgb, #f3dcb4 ${Math.round(35 + 65 * index / Math.max(1, geometry.layers.length - 1))}%, #b98a55)`,
      markings: bare ? [] : visible(layer.markings),
    }));
    if (outputMode !== "stack") return wood;
    const material = geometry.waterInsertMaterial;
    const inserts = (geometry.waterInserts ?? []).flatMap(insert => {
      const layer = geometry.layers[insert.layerIndex];
      if (!layer) return [];
      const fitted = fittedWaterInsert(insert, material?.fitClearanceMm ?? 0, !bare);
      return [{
        kind: "insert" as const, id: insert.id, polygons: fitted.polygons, markings: visible(fitted.markings),
        topMm: layer.index * layer.materialThicknessMm + (material?.thicknessMm ?? layer.materialThicknessMm),
      }];
    });
    const stack = geometry.airspaceStack;
    const airspace = bare || !stack ? [] : stack.levels.map(level => ({
      kind: "airspace" as const, id: `airspace-${level.index}`, topMm: level.zMm + stack.thicknessMm, level,
    }));
    return [...wood, ...inserts, ...airspace].sort((a, b) => a.topMm - b.topMm);
  });
</script>

{#snippet faceMarkings(markings: OperationPath[])}
  {#each markings as marking}
    {#if marking.label && marking.points[0]}
      {@const text = labelPaths(marking)}
      {#if text.fill}<path d={text.fill} fill-rule="evenodd" fill={markingColor(marking)} />{:else}<path d={text.stroke} fill="none" stroke={markingColor(marking)} stroke-width={geometry.lineStyle.annotationMm} />{/if}
    {:else if marking.points.length > 1}
      <path d={markingPath(marking)} fill-rule="evenodd" fill={marking.filled ? markingColor(marking) : "none"} stroke={marking.filled ? "none" : markingColor(marking)} stroke-width={markingWidth(marking, geometry.lineStyle)} stroke-dasharray={markingDash(marking, geometry.lineStyle)} stroke-linecap={markingCap(marking, geometry.lineStyle)} />
    {/if}
  {/each}
{/snippet}

<svg class="stack-top-view" viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`} role="img" aria-label={t("water.topDownView")}>
  {#if outputMode === "engraving"}
    {#if cropShape === "circle"}<circle cx="0" cy="0" r={cropRadiusMm(geometry)} fill="#e8cfaa" />{:else}<rect x={-geometry.widthMm / 2} y={-geometry.heightMm / 2} width={geometry.widthMm} height={geometry.heightMm} fill="#e8cfaa" />{/if}
    {#if !bare}<g fill="none" stroke="#6b4a2d" stroke-width={geometry.lineStyle.contourMm}>
      {#each geometry.layers.slice(1) as layer (layer.id)}
        {#each layer.polygons as polygon}<path d={ringsPath(polygon)} />{/each}
      {/each}
    </g>{/if}
  {/if}
  {#each faces as face (face.id)}
    {#if face.kind === "airspace"}
      <AirspaceLevelArtwork level={face.level} lineStyle={geometry.lineStyle} assembled />
    {:else if face.kind === "insert"}
      <g data-water-insert={face.id}>
        {#each face.polygons as polygon}<path d={ringsPath(polygon)} fill="#82b6c7" fill-opacity="0.58" fill-rule="evenodd" />{/each}
        {@render faceMarkings(face.markings)}
      </g>
    {:else}
      {@const { layer, shade, markings } = face}
      <g data-terrain-layer={layer.id}>
        {#if outputMode === "stack"}
          {#each layer.polygons as polygon}<path d={ringsPath(polygon)} fill={shade} fill-rule="evenodd" stroke="#8a5a32" stroke-width="0.3" />{/each}
          {#each (geometry.waterSurfaces ?? []).filter((surface) => surface.layerIndex === layer.index) as surface (surface.id)}
            {#each surface.openPolygons ?? surface.polygons as polygon}<path d={ringsPath(polygon)} fill="#5f97b5" fill-opacity="0.6" fill-rule="evenodd" />{/each}
          {/each}
        {/if}
        {@render faceMarkings(markings)}
      </g>
    {/if}
  {/each}
</svg>
