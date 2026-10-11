<script lang="ts">
  import SvgViewport from "$lib/studio/SvgViewport.svelte";
  import { airspacePieceMarkings, type AirspaceLevelIR, type GeometryIRV1 } from "@topostack/core";
  import { markingColor, markingDash, markingWidth } from "$lib/studio/marking-style";
  import { labelPaths, markingPath, pointsToPath } from "$lib/studio/svg-path";
  let { geometry, level }: { geometry: GeometryIRV1; level: AirspaceLevelIR } = $props();
  const colors = { clear: "#dcecf2", blue: "#81a9dc", magenta: "#cd8cb6" };
</script>

<div class="two-d-stage">
  <SvgViewport widthMm={geometry.widthMm} heightMm={geometry.heightMm} label="cut" svgLabel={`Airspace cut preview for level ${level.index + 1}`} controlsLabel="Airspace cut zoom controls" resetLabel="Reset airspace cut view">
    {#each level.pieces as piece (piece.id)}
      <g data-airspace-piece={piece.id} data-airspace-tint={piece.tint}>
        {#each piece.polygons as polygon}
          <path d={`${pointsToPath(polygon.outer)} Z ${polygon.holes.map((hole) => `${pointsToPath(hole)} Z`).join(" ")}`} fill={colors[piece.tint]} fill-opacity="0.65" fill-rule="evenodd" stroke="#ca5425" stroke-width="0.45" />
        {/each}
        {#each airspacePieceMarkings(piece) as marking (marking.id)}
          <g data-marking-id={marking.id} data-marking-kind={marking.kind}>
            <path d={markingPath(marking)} fill-rule="evenodd" fill={marking.filled ? "#fff" : "none"} stroke={marking.filled ? "none" : markingColor(marking)} stroke-width={markingWidth(marking, geometry.lineStyle)} stroke-dasharray={markingDash(marking, geometry.lineStyle)} />
            {#if marking.label && marking.points[0]}
              {@const text = labelPaths(marking)}
              {#if text.fill}<path d={text.fill} fill-rule="evenodd" fill={markingColor(marking)} stroke="none" />
              {:else}<path d={text.stroke} fill="none" stroke={markingColor(marking)} stroke-width={geometry.lineStyle.annotationMm} stroke-linecap={text.round ? "round" : "butt"} stroke-linejoin={text.round ? "round" : "miter"} />{/if}
            {/if}
          </g>
        {/each}
      </g>
    {/each}
  </SvgViewport>
  <div class="axis layer-elevation">{level.altitudeFt.toLocaleString()} ft MSL · {geometry.airspaceStack!.thicknessMm} mm acrylic</div>
</div>
