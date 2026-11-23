<script lang="ts">
  import { airspacePieceMarkings, type AirspaceLevelIR, type GeometryIRV1 } from "@topostack/core";
  import { markingColor, markingDash, markingWidth } from "$lib/studio/marking-style";
  import { labelPaths, markingPath, pointsToPath } from "$lib/studio/svg-path";

  let { level, lineStyle, assembled = false }: {
    level: AirspaceLevelIR;
    lineStyle: GeometryIRV1["lineStyle"];
    assembled?: boolean;
  } = $props();

  const colors = { clear: "#dcecf2", blue: "#81a9dc", magenta: "#cd8cb6" };
</script>

{#each level.pieces as piece (piece.id)}
  <g data-airspace-piece={piece.id} data-airspace-tint={piece.tint}>
    {#each piece.polygons as polygon}
      <path d={`${pointsToPath(polygon.outer)} Z ${polygon.holes.map((hole) => `${pointsToPath(hole)} Z`).join(" ")}`} fill={colors[piece.tint]} fill-opacity={assembled ? (piece.tint === "clear" ? 0.24 : 0.48) : 0.65} fill-rule="evenodd" stroke={assembled ? "#496375" : "#ca5425"} stroke-width={assembled ? 0.3 : 0.45} />
    {/each}
    {#each airspacePieceMarkings(piece) as marking (marking.id)}
      <g data-marking-id={marking.id} data-marking-kind={marking.kind}>
        <path d={markingPath(marking)} fill-rule="evenodd" fill={marking.filled ? "#fff" : "none"} fill-opacity={assembled && marking.filled ? 0.45 : 1} stroke={marking.filled ? "none" : markingColor(marking)} stroke-width={markingWidth(marking, lineStyle)} stroke-dasharray={markingDash(marking, lineStyle)} />
        {#if marking.label && marking.points[0]}
          {@const text = labelPaths(marking)}
          {#if text.fill}<path d={text.fill} fill-rule="evenodd" fill={markingColor(marking)} stroke="none" />
          {:else}<path d={text.stroke} fill="none" stroke={markingColor(marking)} stroke-width={lineStyle.annotationMm} stroke-linecap={text.round ? "round" : "butt"} stroke-linejoin={text.round ? "round" : "miter"} />{/if}
        {/if}
      </g>
    {/each}
  </g>
{/each}
