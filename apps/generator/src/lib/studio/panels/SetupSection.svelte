<script lang="ts">
  import LocationPicker from "$lib/studio/panels/LocationPicker.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { t } from "$lib/i18n/i18n.svelte";
</script>

<!-- The embed's lead rail. The standalone studio shows the location in its Place panel. -->
<PanelFrame id="setup" title={t("place.projectSetup")} disclosure><LocationPicker /></PanelFrame>
