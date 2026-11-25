<script lang="ts">
  import LocationPicker from "$lib/studio/panels/LocationPicker.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import SizeFields from "$lib/studio/panels/SizeFields.svelte";
  import UnitSwitch from "$lib/studio/panels/UnitSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  const studio = getStudio();
  const engraving = $derived(studio.project.outputMode === "engraving");
</script>

<!-- Where the model is and how big. The embed keeps the location in its lead rail, so its block is the size alone. -->
<PanelFrame id="place" title={studio.embeddedInPlatform ? (engraving ? t("place.artworkSize") : t("place.cutSize")) : t("place.placeAndSize")}>
  {#if !studio.embeddedInPlatform}<div class="detail-group"><LocationPicker /></div>{/if}
  <div class="detail-group size-group">
    {#if !studio.embeddedInPlatform}<p class="subgroup-heading">{engraving ? t("place.artworkSize") : t("place.cutSize")}</p><UnitSwitch />{/if}
    <SizeFields />
  </div>
</PanelFrame>
