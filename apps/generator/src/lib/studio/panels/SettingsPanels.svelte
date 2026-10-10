<script lang="ts">
  import AtommMaterialSize from "$lib/atomm/AtommMaterialSize.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import AviationPanel from "$lib/studio/panels/AviationPanel.svelte";
  import FeaturesPanel from "$lib/studio/panels/FeaturesPanel.svelte";
  import LabelsPanel from "$lib/studio/panels/LabelsPanel.svelte";
  import MakePanel from "$lib/studio/panels/MakePanel.svelte";
  import PlacePanel from "$lib/studio/panels/PlacePanel.svelte";
  import TerrainPanel from "$lib/studio/panels/TerrainPanel.svelte";
  import WaterPanel from "$lib/studio/panels/WaterPanel.svelte";

  let { openLakeDepthHelp }: { openLakeDepthHelp?: (trigger: HTMLButtonElement) => void } = $props();
  const studio = getStudio();

  /**
   * The project's settings as the platform embed shows them: one disclosure
   * per subject, in rail order. The standalone studio shows the same panels
   * in its rail (`SettingsRail.svelte`). Markers, paths and file import live
   * in the custom data view; the embed keeps them in its lead rail.
   */
</script>

{#if studio.embeddedInPlatform && studio.mode === "export" && studio.project.outputMode === "stack"}<AtommMaterialSize />{/if}
<PlacePanel />
<TerrainPanel />
<FeaturesPanel />
<WaterPanel {openLakeDepthHelp} />
<AviationPanel />
<LabelsPanel />
<MakePanel />
