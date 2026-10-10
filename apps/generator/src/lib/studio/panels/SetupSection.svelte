<script lang="ts">
  import LocationPicker from "$lib/studio/panels/LocationPicker.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
</script>

<!-- The embed's lead rail. The standalone studio shows the location in its Place panel. -->
<PanelFrame id="setup" title="Project setup" disclosure><LocationPicker /></PanelFrame>
