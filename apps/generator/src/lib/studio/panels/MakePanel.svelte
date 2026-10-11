<script lang="ts">
  import { Download, Layers3 } from "@lucide/svelte";
  import { displayLength, MAX_PROJECT_DIMENSION_MM } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import NestsAndSeams from "$lib/studio/panels/NestsAndSeams.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /** The machine and the build: kerf, smallest cuttable feature, work area, and the guides that help assembly. */
  const studio = getStudio();
  const { shownLength, storedLength, updateFabrication, updateMapDetails, workAreaLength } = studio;
  const stack = $derived(studio.project.outputMode === "stack");
</script>

<PanelFrame id="make" title="Fabrication" class="make-panel">
  <div class="detail-group">
    <p class="subgroup-heading">Machine</p>
    <div class="field-stack">
      {#if stack}<LengthField label="Laser kerf" unit={studio.shownLengthUnit} value={shownLength(studio.project.laserKerfMm)} min={0} max={shownLength(1)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onCommit={(shown) => { const laserKerfMm = storedLength(shown); if (laserKerfMm !== studio.project.laserKerfMm) void updateFabrication({ laserKerfMm }); }} />{/if}
      <LengthField label="Minimum feature" unit={studio.shownLengthUnit} value={shownLength(studio.project.minimumFeatureMm)} min={shownLength(0.2)} max={shownLength(5)} step={studio.project.units === "imperial" ? 0.01 : 0.1} onCommit={(shown) => { const minimumFeatureMm = storedLength(shown); if (minimumFeatureMm !== studio.project.minimumFeatureMm) void updateFabrication({ minimumFeatureMm }); }} />
      {#if stack}<LengthField label="Work area width" unit={studio.shownLengthUnit} value={shownLength(studio.project.workAreaWidthMm)} min={0} max={displayLength(MAX_PROJECT_DIMENSION_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.1 : 1} onCommit={(shown) => { const workAreaWidthMm = workAreaLength(shown); if (workAreaWidthMm !== studio.project.workAreaWidthMm) void updateFabrication({ workAreaWidthMm }); }} />{/if}
      {#if stack}<LengthField label="Work area height" unit={studio.shownLengthUnit} value={shownLength(studio.project.workAreaHeightMm)} min={0} max={displayLength(MAX_PROJECT_DIMENSION_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.1 : 1} onCommit={(shown) => { const workAreaHeightMm = workAreaLength(shown); if (workAreaHeightMm !== studio.project.workAreaHeightMm) void updateFabrication({ workAreaHeightMm }); }} />{/if}
    </div>
    {#if stack}<p class="seam-summary">{studio.seamSummary}</p>{/if}
  </div>
  {#if stack}
    <div class="detail-group">
      <p class="subgroup-heading">Assembly</p>
      <div class="toggle-stack">
        <Switch checked={studio.project.showAlignmentGuides} onCheckedChange={(showAlignmentGuides) => void updateMapDetails({ showAlignmentGuides })} aria-label="Assembly guides"><span class="toggle-label"><Layers3 size={16} />Assembly guides</span></Switch>
      </div>
    </div>
    {#if studio.embeddedInPlatform}
      <div class="detail-group"><NestsAndSeams /></div>
    {:else}
      <div class="detail-group export-pointer">
        <p class="depth-note">Material-saving nests, seams and sheet layout are set when you export.</p>
        <button type="button" class="btn btn-secondary" onclick={() => studio.openExport()}><Download size={16} aria-hidden="true" />Open export</button>
      </div>
    {/if}
  {/if}
</PanelFrame>
