<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";
  const base = basePath();

  let { openLakeDepthHelp }: { openLakeDepthHelp?: (trigger: HTMLButtonElement) => void } = $props();
  const studio = getStudio();
</script>

{#if openLakeDepthHelp}
  <button type="button" class="btn btn-secondary btn-sm lake-depth-help" aria-haspopup="dialog" onclick={(event) => openLakeDepthHelp(event.currentTarget)}>{t("water.lakeDepthHelp")}</button>
{:else if !studio.embeddedInPlatform}
  <a href={`${base}/guides/how-lake-depths-work`} target="_blank" rel="noopener noreferrer">{t("water.lakeDepthHelp")}<span class="ldt-visually-hidden">{` ${t("water.opensInNewTab")}`}</span></a>
{/if}
