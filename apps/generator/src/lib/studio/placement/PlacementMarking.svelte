<script lang="ts">
  import { SCORE_BURN_WIDTH_MM, type LineStyleV1, type OperationPath } from "@topostack/core";
  import { markingCap, markingColor, markingDash } from "$lib/studio/marking-style";
  import { labelPaths, markingPath } from "$lib/studio/svg-path";

  let { marking, lineStyle }: { marking: OperationPath; lineStyle: LineStyleV1 } = $props();
  // Static backdrop markings keep their paths while a draft moves above them.
  const text = $derived(marking.label ? labelPaths(marking) : undefined);
  const path = $derived(markingPath(marking));
</script>

{#if text}
  {#if text.fill}<path d={text.fill} fill-rule="evenodd" fill={markingColor(marking)} />
  {:else}<path d={text.stroke} fill="none" stroke={markingColor(marking)} stroke-width={SCORE_BURN_WIDTH_MM} stroke-linecap={text.round ? "round" : "butt"} stroke-linejoin={text.round ? "round" : "miter"} />{/if}
{:else}
  <path d={path} fill={marking.filled ? markingColor(marking) : "none"} fill-rule="evenodd" stroke={marking.filled ? "none" : markingColor(marking)} stroke-width={SCORE_BURN_WIDTH_MM} stroke-dasharray={markingDash(marking, lineStyle)} stroke-linecap={markingCap(marking, lineStyle)} stroke-linejoin={marking.kind === "road" ? "round" : undefined} />
{/if}
