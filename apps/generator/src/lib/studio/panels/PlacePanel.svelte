<script lang="ts">
  import { Circle, Square } from "@lucide/svelte";
  import { displayLength, MAX_PROJECT_DIMENSION_MM, type ProjectConfigV1 } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import { SHAPE_OPTIONS } from "$lib/studio/options";
  import LocationPicker from "$lib/studio/panels/LocationPicker.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import UnitSwitch from "$lib/studio/panels/UnitSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";

  const studio = getStudio();
  const { navigateChoice, shownLength, storedLength, updateFabrication } = studio;
  const engraving = $derived(studio.project.outputMode === "engraving");
</script>

<!-- Where the model is and how big. The embed keeps the location in its lead rail, so its block is the size alone. -->
<PanelFrame id="place" title={studio.embeddedInPlatform ? (engraving ? t("place.artworkSize") : t("place.cutSize")) : t("place.placeAndSize")}>
  {#if !studio.embeddedInPlatform}<div class="detail-group"><LocationPicker /></div>{/if}
  <div class="detail-group size-group">
    {#if !studio.embeddedInPlatform}<p class="subgroup-heading">{engraving ? t("place.artworkSize") : t("place.cutSize")}</p><UnitSwitch />{/if}
    <div class="ldt-toggle-group shape-switch" role="radiogroup" aria-label={t("place.cropShape")}>
      {#each SHAPE_OPTIONS as option}
        <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.project.cropShape === option.value} data-state={studio.project.cropShape === option.value ? "on" : "off"} tabindex={studio.project.cropShape === option.value ? 0 : -1} onclick={() => void updateFabrication({ cropShape: option.value as ProjectConfigV1["cropShape"], ...(option.value === "circle" ? { heightMm: studio.project.widthMm } : {}) })} onkeydown={navigateChoice}>{#if option.value === "rectangle"}<Square size={15} />{:else}<Circle size={15} />{/if}{t(`place.shape.${option.value}` as MessageKey)}</button>
      {/each}
    </div>
    <div class="field-stack">
      <LengthField label={t("place.width")} unit={studio.shownLengthUnit} value={shownLength(studio.project.widthMm)} min={studio.project.units === "imperial" ? 0.001 : 0.01} max={displayLength(MAX_PROJECT_DIMENSION_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 1} onCommit={(shown) => { const widthMm = storedLength(shown); if (widthMm !== studio.project.widthMm) void updateFabrication({ widthMm, ...(studio.project.cropShape === "circle" ? { heightMm: widthMm } : {}) }); }} />
      <LengthField label={t("place.height")} unit={studio.shownLengthUnit} value={shownLength(studio.project.heightMm)} min={studio.project.units === "imperial" ? 0.001 : 0.01} max={displayLength(MAX_PROJECT_DIMENSION_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 1} disabled={studio.project.cropShape === "circle"} onCommit={(shown) => { const heightMm = storedLength(shown); if (heightMm !== studio.project.heightMm) void updateFabrication({ heightMm }); }} />
    </div>
  </div>
</PanelFrame>
