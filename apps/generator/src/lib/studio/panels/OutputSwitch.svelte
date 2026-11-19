<script lang="ts">
  import { Layers3, PenTool } from "@lucide/svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  const studio = getStudio();
  const { navigateChoice, updateFabrication } = studio;
</script>

<div class="ldt-toggle-group ldt-toggle-group--sm output-mode-switch" role="radiogroup" aria-label={t("place.outputType")}>
  <button type="button" class="ldt-toggle-group__item" role="radio" aria-label={t("place.layeredRelief")} aria-checked={studio.project.outputMode === "stack"} data-state={studio.project.outputMode === "stack" ? "on" : "off"} tabindex={studio.project.outputMode === "stack" ? 0 : -1} onclick={() => { studio.mode = studio.threeUnavailable ? "2d" : "3d"; void updateFabrication({ outputMode: "stack" }); }} onkeydown={navigateChoice}>
    <span class="output-mode-switch__icon" aria-hidden="true"><Layers3 size={16} strokeWidth={2.2} /></span>
    <span>{t("place.layered")}</span>
  </button>
  <button type="button" class="ldt-toggle-group__item" role="radio" aria-label={t("place.flatEngraving")} aria-checked={studio.project.outputMode === "engraving"} data-state={studio.project.outputMode === "engraving" ? "on" : "off"} tabindex={studio.project.outputMode === "engraving" ? 0 : -1} onclick={() => { studio.mode = "engraving"; void updateFabrication({ outputMode: "engraving" }); }} onkeydown={navigateChoice}>
    <span class="output-mode-switch__icon" aria-hidden="true"><PenTool size={16} strokeWidth={2.2} /></span>
    <span>{t("place.flat")}</span>
  </button>
</div>
