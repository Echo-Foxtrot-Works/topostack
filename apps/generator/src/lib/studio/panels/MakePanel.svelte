<script lang="ts">
  import { Button } from "@loidolt/theme-svelte";
  import { Download, Layers3 } from "@lucide/svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import MachineFields from "$lib/studio/panels/MachineFields.svelte";
  import NestsAndSeams from "$lib/studio/panels/NestsAndSeams.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  /** The machine and the build: kerf, smallest cuttable feature, work area, and the guides that help assembly. */
  const studio = getStudio();
  const { updateMapDetails } = studio;
  const stack = $derived(studio.project.outputMode === "stack");
</script>

<PanelFrame id="make" title={t("terrain.fabrication")} class="make-panel">
  <div class="detail-group">
    <p class="subgroup-heading">{t("terrain.machine")}</p>
    <MachineFields />
  </div>
  {#if stack}
    <div class="detail-group">
      <p class="subgroup-heading">{t("terrain.assembly")}</p>
      <div class="toggle-stack">
        <Switch checked={studio.project.showAlignmentGuides} onCheckedChange={(showAlignmentGuides) => void updateMapDetails({ showAlignmentGuides })} aria-label={t("terrain.assemblyGuides")}><span class="toggle-label"><Layers3 size={16} />{t("terrain.assemblyGuides")}</span></Switch>
      </div>
    </div>
    {#if studio.embeddedInPlatform}
      <div class="detail-group"><NestsAndSeams /></div>
    {:else}
      <div class="detail-group export-pointer">
        <p class="depth-note">{t("terrain.exportPointer")}</p>
        <Button class="btn btn-secondary" onclick={() => studio.openExport()}><Download size={16} aria-hidden="true" />{t("terrain.openExport")}</Button>
      </div>
    {/if}
  {/if}
</PanelFrame>
