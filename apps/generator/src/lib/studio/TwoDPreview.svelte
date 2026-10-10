<script lang="ts">
  import AirspaceCutPreview from "$lib/studio/AirspaceCutPreview.svelte";
  import SvgViewport from "$lib/studio/SvgViewport.svelte";
  import { displayElevation, elevationUnit, paintStencil, type GeometryIRV1 } from "@topostack/core";
  import { Switch } from "@loidolt/theme-svelte";
  import { markingColor, markingDash, markingWidth } from "$lib/studio/marking-style";
  import { labelPaths, markingPath, pointsToPath } from "$lib/studio/svg-path";
  let { geometry, selectedLayer, selectedAirspaceLevel }: { geometry: GeometryIRV1; selectedLayer: number; selectedAirspaceLevel?: number } = $props();
  const airspaceLevel = $derived(selectedAirspaceLevel === undefined ? undefined : geometry.airspaceStack?.levels[selectedAirspaceLevel]);
  const layer = $derived(geometry.layers[selectedLayer] ?? geometry.layers[0]);
  // Every sheet at or below the waterline sits under water, so the tint marks
  // which part of this sheet the basin covers.
  const submerged = $derived((geometry.waterSurfaces ?? []).filter((surface) => (layer?.index ?? 0) <= surface.layerIndex));
  // The stencil windows for this sheet: exposed water plus the bleed under the layer above.
  const paint = $derived((geometry.paintRegions ?? []).filter((region) => region.layerIndex === (layer?.index ?? 0)));
  // Acrylic set into this sheet's openings: drawn where it will sit, with the detail engraved on it.
  const inserts = $derived((geometry.waterInserts ?? []).filter((insert) => insert.layerIndex === (layer?.index ?? 0)));
  // Lays the paper stencil over the sheet as it is cut: the piece less its
  // windows as one outline, so the paint shows only where the paper is gone.
  let showTemplate = $state(false);
  const ringPath = (ring: { x: number; y: number }[]) => `${pointsToPath(ring)} Z`;
  const templates = $derived(paint.flatMap((region) => {
    const polygon = layer?.polygons[region.polygonIndex];
    if (!polygon) return [];
    // IR from before stencils were merged carries windows only: cut the paper here, bridges and all.
    const paper = region.paper ?? paintStencil(polygon, region.polygons, 0);
    return [{ key: `${region.kind}-${region.polygonIndex}`, sheets: paper.map((sheet) => [sheet.outer, ...sheet.holes].map(ringPath).join(" ")) }];
  }));
</script>

{#if airspaceLevel}
  <AirspaceCutPreview {geometry} level={airspaceLevel} />
{:else if layer}
  <div class="two-d-stage">
    <SvgViewport widthMm={geometry.widthMm} heightMm={geometry.heightMm} label="cut" svgLabel={`Cut preview for layer ${layer.index + 1}`} controlsLabel="Cut layers zoom controls" resetLabel="Reset cut view">
      <defs><filter id="paper-shadow"><feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.2" /></filter></defs>
      <g data-preview-shadow filter="url(#paper-shadow)">
        {#each layer.polygons as polygon}
          <!-- Each ring is walked once: the fill and the stroke reuse the same path. -->
          {@const outline = `${pointsToPath(polygon.outer)} Z`}
          {@const holes = polygon.holes.map((hole) => `${pointsToPath(hole)} Z`)}
          <g>
            <path d={`${outline} ${holes.join(" ")}`} fill="#e7c391" stroke="none" fill-rule="evenodd" />
            <path d={outline} fill="none" stroke="#ca5425" stroke-width="0.45" />
            {#each holes as hole}
              <path d={hole} fill="none" stroke="#ca5425" stroke-width="0.45" />
            {/each}
          </g>
        {/each}
      </g>
      {#each submerged as surface (surface.id)}
        {#each surface.polygons as polygon}
          <path d={`${pointsToPath(polygon.outer)} Z ${polygon.holes.map((hole) => `${pointsToPath(hole)} Z`).join(" ")}`} fill="#7fb2cc" fill-opacity="0.38" stroke="none" fill-rule="evenodd" />
        {/each}
      {/each}
      {#each paint as region (`${region.kind}-${region.polygonIndex}`)}
        {#each region.polygons as polygon}
          <path data-paint-kind={region.kind} d={`${pointsToPath(polygon.outer)} Z ${polygon.holes.map((hole) => `${pointsToPath(hole)} Z`).join(" ")}`} fill="#2f7fb0" fill-opacity="0.55" stroke="#1f5f88" stroke-width="0.3" stroke-dasharray="1 0.8" fill-rule="evenodd" />
        {/each}
      {/each}
      {#each layer.markings as marking (marking.id)}
        <g data-marking-id={marking.id} data-marking-kind={marking.kind} data-transportation-class={marking.transportationClass}><path d={markingPath(marking)} fill-rule="evenodd" fill={marking.knockout ? "#e7c391" : marking.filled ? markingColor(marking) : "none"} stroke={marking.filled ? "none" : markingColor(marking)} stroke-width={markingWidth(marking, geometry.lineStyle)} stroke-dasharray={markingDash(marking, geometry.lineStyle)} stroke-linecap={marking.kind === "road" ? geometry.lineStyle.roadCap : marking.kind === "grid" ? "round" : undefined} stroke-linejoin={marking.kind === "road" ? "round" : undefined} />{#if marking.label && marking.points[0]}{@const text = labelPaths(marking)}{#if text.fill}<path d={text.fill} fill-rule="evenodd" fill={markingColor(marking)} stroke="none" />{:else}<path d={text.stroke} fill="none" stroke={markingColor(marking)} stroke-width={geometry.lineStyle.annotationMm} stroke-linecap={text.round ? "round" : "butt"} stroke-linejoin={text.round ? "round" : "miter"} />{/if}{/if}</g>
      {/each}
      {#each inserts as insert (insert.id)}
        <g data-water-insert={insert.id}>
          {#each insert.polygons as polygon}
            <path d={`${pointsToPath(polygon.outer)} Z ${polygon.holes.map((hole) => `${pointsToPath(hole)} Z`).join(" ")}`} fill="#7fb2cc" fill-opacity="0.45" stroke="#1f5f7d" stroke-width="0.35" stroke-dasharray="1.2 0.8" fill-rule="evenodd" />
          {/each}
          {#each insert.markings.filter((marking) => !marking.knockout) as marking (marking.id)}
            <path d={markingPath(marking)} fill-rule="evenodd" fill={marking.filled ? markingColor(marking) : "none"} stroke={marking.filled ? "none" : markingColor(marking)} stroke-width={markingWidth(marking, geometry.lineStyle)} stroke-dasharray={markingDash(marking, geometry.lineStyle)} />{#if marking.label && marking.points[0]}{@const text = labelPaths(marking)}{#if text.fill}<path d={text.fill} fill-rule="evenodd" fill={markingColor(marking)} stroke="none" />{:else}<path d={text.stroke} fill="none" stroke={markingColor(marking)} stroke-width={geometry.lineStyle.annotationMm} />{/if}{/if}
          {/each}
        </g>
      {/each}
      {#if showTemplate}
        {#each templates as template (template.key)}
          <g data-paint-template>
            {#each template.sheets as sheet}
              <path d={sheet} fill="#f6f1e6" fill-opacity="0.88" stroke="#c9302c" stroke-width="0.35" fill-rule="evenodd" />
            {/each}
          </g>
        {/each}
      {/if}
    </SvgViewport>
    <div class="axis layer-elevation">{Math.round(displayElevation(layer.elevationM, geometry.units)).toLocaleString()} {elevationUnit(geometry.units)}</div>
    {#if (geometry.paintRegions ?? []).length}
      <div class="axis paint-template-toggle">
        <Switch checked={showTemplate} disabled={!paint.length} onCheckedChange={(checked) => { showTemplate = checked; }} aria-label="Show paint template">{paint.length ? "Paint template" : "No paint template on this layer"}</Switch>
      </div>
    {/if}
  </div>
{/if}
