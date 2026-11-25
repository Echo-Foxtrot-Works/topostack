<script lang="ts">
  import { LINE_PRESETS } from "$lib/studio/options";
  import { getStudio } from "$lib/studio/studio-context";
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";

  /** The three line weights, each setting every stroke in the project; shared by the Features panel and the setup guide. */
  const studio = getStudio();
  const { trailPatternDash, updateFabrication } = studio;
</script>

<div class="line-presets" role="radiogroup" aria-label={t("features.lineworkPreset")}>
  {#each LINE_PRESETS as preset}
    <button type="button" role="radio" aria-checked={studio.activeLinePreset === preset.value} data-state={studio.activeLinePreset === preset.value ? "on" : "off"} onclick={() => void updateFabrication({ lineStyle: { ...preset.style } })}>
      <svg viewBox="0 0 52 24" aria-hidden="true">
        <path d="M2 5H50" stroke-width={preset.style.contourMm * 5} />
        <path d="M2 12H50" stroke-width={preset.style.indexContourMm * 5} />
        <path d="M2 19H50" stroke-width={preset.style.trailMm * 5} stroke-dasharray={trailPatternDash(preset.style)} />
      </svg>
      <span><b>{t(`features.linePresetLabel.${preset.value}` as MessageKey)}</b><small>{t(`features.linePresetDescription.${preset.value}` as MessageKey)}</small></span>
    </button>
  {/each}
</div>
