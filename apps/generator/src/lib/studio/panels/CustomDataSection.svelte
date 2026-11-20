<script lang="ts">
  import ImportTools from "$lib/studio/customdata/ImportTools.svelte";
  import MarkerTools from "$lib/studio/customdata/MarkerTools.svelte";
  import PathTools from "$lib/studio/customdata/PathTools.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  /**
   * Markers and paths inside the platform embed, whose rails are the
   * platform's own and do not change with the preview.
   *
   * The standalone studio moved these into the custom data view, where they
   * sit beside a map to place them on; both render the same editors. Graphics
   * and depth charts stay out of the embed: Atomm's own Studio places artwork,
   * and tracing a chart is a job for the full studio.
   */

  const studio = getStudio();
</script>

<PanelFrame id="customData" title={studio.embeddedInPlatform ? t("customdata.sectionTitleEmbed") : t("customdata.sectionTitle")} class="custom-data-section" disclosure>
  <p class="custom-data-intro">{t("customdata.intro")}</p>
  <ImportTools />
  <MarkerTools />
  <PathTools />
</PanelFrame>
