<script lang="ts">
  import { type ProjectConfigV1 } from "@topostack/core";
  import { UNIT_OPTIONS } from "$lib/studio/options";
  import { getStudio } from "$lib/studio/studio-context";
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";

  const studio = getStudio();
  const { navigateChoice, updateFabrication } = studio;
</script>

<div class="ldt-toggle-group unit-switch" role="radiogroup" aria-label={t("place.displayUnits")}>
  {#each UNIT_OPTIONS as option}
    <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.project.units === option.value} data-state={studio.project.units === option.value ? "on" : "off"} tabindex={studio.project.units === option.value ? 0 : -1} onclick={() => void updateFabrication({ units: option.value as ProjectConfigV1["units"] })} onkeydown={navigateChoice}>{t(`place.units.${option.value}` as MessageKey)}</button>
  {/each}
</div>
