<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import { getStudio } from "$lib/studio/studio-context";
  const base = basePath();

  let { openLakeDepthHelp }: { openLakeDepthHelp?: (trigger: HTMLButtonElement) => void } = $props();
  const studio = getStudio();
</script>

{#if openLakeDepthHelp}
  <button type="button" class="btn btn-secondary btn-sm lake-depth-help" aria-haspopup="dialog" onclick={(event) => openLakeDepthHelp(event.currentTarget)}>How lake depths work</button>
{:else if !studio.embeddedInPlatform}
  <a href={`${base}/guides/how-lake-depths-work`} target="_blank" rel="noopener noreferrer">How lake depths work<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
{/if}
