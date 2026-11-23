<script lang="ts">
  import { SCORE_BURN_WIDTH_MM, plaqueFootprint, type GeometryIRV1, type OperationPath, type ProjectConfigV1 } from "@topostack/core";
  import { markingPath, pointsToPath } from "$lib/studio/svg-path";
  import { availablePlaceables, hiddenByPrefix, type PlacementContext } from "./placeables";
  import PlacementMarking from "./PlacementMarking.svelte";

  let { geometry, project, context, hiddenPrefixes }: {
    geometry: GeometryIRV1;
    project: ProjectConfigV1;
    context: PlacementContext;
    hiddenPrefixes: readonly string[];
  } = $props();
  const id = $props.id();
  const layers = $derived(geometry.layers);
  const markings = $derived(layers.flatMap(layer => layer.markings).filter(marking => !hiddenByPrefix(marking.id, hiddenPrefixes) && !marking.id.startsWith("alignment-")));
  const background = $derived(markings.filter(marking => !marking.id.startsWith("map-marker-") && !marking.knockout));
  // Generation draws markers last, in project order. Their knockouts erase
  // earlier artwork without painting over the material texture underneath.
  const markers = $derived.by(() => {
    const groups = new Map<string, OperationPath[]>();
    for (const marking of markings) {
      const key = marking.id.match(/^map-marker-(\d+)-/)?.[1];
      if (key === undefined) continue;
      const group = groups.get(key) ?? [];
      group.push(marking);
      groups.set(key, group);
    }
    return [...groups].sort(([a], [b]) => Number(a) - Number(b)).map(([key, paths]) => ({ key, paths }));
  });
  const halos = $derived(markers.flatMap(group => group.paths.filter(marking => marking.knockout)));
  const footprint = $derived(plaqueFootprint(project));
  const allDrafts = $derived(availablePlaceables(project).map(placeable => ({ id: placeable.id, markings: placeable.markings(project, context) })));
  const drafts = $derived(allDrafts.filter(item => !item.id.startsWith("graphic:")));
  // Generation places graphics after the title and before markers: their halos
  // clear everything drawn earlier, and markers' halos clear them.
  const graphics = $derived(allDrafts.filter(item => item.id.startsWith("graphic:")));
  const graphicHalos = $derived(graphics.flatMap(item => item.markings.filter(marking => marking.knockout)));
</script>

{#snippet white()}
  <rect x={-geometry.widthMm} y={-geometry.heightMm} width={geometry.widthMm * 2} height={geometry.heightMm * 2} fill="white" />
{/snippet}
{#snippet holes(paths: OperationPath[])}
  {#each paths as marking (marking.id)}<path d={markingPath(marking)} fill="black" fill-rule="evenodd" />{/each}
{/snippet}
<defs>
  <mask id={`${id}-before-title`} maskUnits="userSpaceOnUse" x={-geometry.widthMm} y={-geometry.heightMm} width={geometry.widthMm * 2} height={geometry.heightMm * 2}>
    {@render white()}
    {#if footprint}<path data-placement-knockout="plaque" d={`${pointsToPath(footprint)} Z`} fill="black" />{/if}
    {@render holes(halos)}{@render holes(graphicHalos)}
  </mask>
  <mask id={`${id}-before-markers`} maskUnits="userSpaceOnUse" x={-geometry.widthMm} y={-geometry.heightMm} width={geometry.widthMm * 2} height={geometry.heightMm * 2}>
    {@render white()}{@render holes(halos)}{@render holes(graphicHalos)}
  </mask>
  {#each graphics as graphic, index (graphic.id)}
    <mask id={`${id}-${graphic.id.replace(":", "-")}`} maskUnits="userSpaceOnUse" x={-geometry.widthMm} y={-geometry.heightMm} width={geometry.widthMm * 2} height={geometry.heightMm * 2}>
      {@render white()}{@render holes(halos)}{@render holes(graphics.slice(index + 1).flatMap(later => later.markings.filter(marking => marking.knockout)))}
    </mask>
  {/each}
  {#each markers as group, index (group.key)}
    <mask id={`${id}-marker-${group.key}`} maskUnits="userSpaceOnUse" x={-geometry.widthMm} y={-geometry.heightMm} width={geometry.widthMm * 2} height={geometry.heightMm * 2}>
      {@render white()}{@render holes(markers.slice(index + 1).flatMap(later => later.paths.filter(marking => marking.knockout)))}
    </mask>
  {/each}
</defs>
<g data-placement-artwork>
  <g mask={`url(#${id}-before-title)`}>
    {#if project.outputMode === "engraving"}
      <g fill="none" stroke="#6b4a2d" stroke-width={SCORE_BURN_WIDTH_MM}>
        {#each layers.slice(1) as layer (layer.id)}
          {#each layer.polygons as polygon}<path d={[polygon.outer, ...polygon.holes].map(ring => `${pointsToPath(ring)} Z`).join(" ")} />{/each}
        {/each}
      </g>
    {/if}
    {#each background as marking (marking.id)}<PlacementMarking {marking} lineStyle={geometry.lineStyle} />{/each}
    {#each drafts.filter(item => item.id !== "plaque") as item (item.id)}
      {#each item.markings as marking (marking.id)}<PlacementMarking {marking} lineStyle={project.lineStyle} />{/each}
    {/each}
  </g>
  <g mask={`url(#${id}-before-markers)`}>
    {#each drafts.filter(item => item.id === "plaque") as item (item.id)}
      {#each item.markings as marking (marking.id)}<PlacementMarking {marking} lineStyle={project.lineStyle} />{/each}
    {/each}
  </g>
  {#each graphics as graphic (graphic.id)}
    <g data-placement-graphic={graphic.id} mask={`url(#${id}-${graphic.id.replace(":", "-")})`}>
      {#each graphic.markings.filter(marking => !marking.knockout) as marking (marking.id)}
        {#if marking.kind === "guide"}<path class="placement-cut-draft" d={markingPath(marking)} />
        {:else}<PlacementMarking {marking} lineStyle={project.lineStyle} />{/if}
      {/each}
    </g>
  {/each}
  {#each markers as group (group.key)}
    <g data-placement-marker={group.key} mask={`url(#${id}-marker-${group.key})`}>
      {#each group.paths.filter(marking => !marking.knockout) as marking (marking.id)}<PlacementMarking {marking} lineStyle={geometry.lineStyle} />{/each}
    </g>
  {/each}
</g>
