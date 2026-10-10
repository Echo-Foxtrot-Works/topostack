<script lang="ts">
  import { Grid3X3, Layers3, Puzzle } from "@lucide/svelte";
  import { MAX_SEAM_OFFSET_MM } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * How layered panels are cut up and packed: small layers nested inside
   * larger ones, and layers too big for the work area split along seams.
   * The standalone studio shows these in the export dialog beside the sheet
   * layout; the platform embed, which exports through the platform, keeps
   * them in its Fabrication block.
   */
  let { disabled = false }: { disabled?: boolean } = $props();
  const studio = getStudio();
  const { shownLength, storedLength, updateFabrication } = studio;
</script>

<section class="nests-and-seams" class:sheet-layout={!studio.embeddedInPlatform} aria-labelledby="nests-and-seams-title">
  {#if studio.embeddedInPlatform}
    <p id="nests-and-seams-title" class="subgroup-heading">Panels and seams</p>
  {:else}
    <header class="sheet-layout-header">
      <span class="export-row-icon"><Puzzle size={20} strokeWidth={1.6} /></span>
      <div><h3 id="nests-and-seams-title">Panels and seams</h3><p>How each layer is cut into panels before they are laid out on sheets. Changes here update the preview.</p></div>
    </header>
  {/if}
  <div class="toggle-stack">
    <Switch checked={studio.project.optimizeMaterialUse} {disabled} onCheckedChange={(optimizeMaterialUse) => void updateFabrication({ optimizeMaterialUse })} aria-label="Material-saving nests"><span class="toggle-label"><Layers3 size={16} />Material-saving nests</span></Switch>
    {#if studio.project.optimizeMaterialUse}
      <div class="toggle-settings">
        <div class="field-stack"><LengthField label="Glue margin" unit={studio.shownLengthUnit} value={shownLength(studio.project.glueMarginMm)} min={shownLength(2)} max={shownLength(25)} step={studio.project.units === "imperial" ? 0.01 : 0.5} {disabled} onCommit={(shown) => { const glueMarginMm = storedLength(shown); if (glueMarginMm !== studio.project.glueMarginMm) void updateFabrication({ glueMarginMm }); }} /></div>
        <small class="depth-note">Cuts upper layers from the covered parts of lower sheets, leaving this much wood around each cutout for glue.</small>
      </div>
    {/if}
    {#if studio.seamGrid}
      <Switch checked={studio.project.seamTabs} {disabled} onCheckedChange={(seamTabs) => void updateFabrication({ seamTabs })} aria-label="Puzzle seam tabs"><span class="toggle-label"><Puzzle size={16} />Puzzle seam tabs</span></Switch>
      <Switch checked={studio.project.showAssemblyLabels} {disabled} onCheckedChange={(showAssemblyLabels) => void updateFabrication({ showAssemblyLabels })} aria-label="Assembly labels"><span class="toggle-label"><Grid3X3 size={16} />Assembly labels</span></Switch>
      <div class="field-stack"><LengthField label="Seam offset" unit={studio.shownLengthUnit} value={shownLength(studio.project.seamOffsetMm)} min={0} max={shownLength(MAX_SEAM_OFFSET_MM)} step={studio.project.units === "imperial" ? 0.01 : 1} {disabled} onCommit={(shown) => { const seamOffsetMm = storedLength(shown); if (seamOffsetMm !== studio.project.seamOffsetMm) void updateFabrication({ seamOffsetMm }); }} /></div>
    {/if}
  </div>
  <p class="seam-summary">{studio.embeddedInPlatform ? studio.seamSummary : `${studio.seamSummary} The work area is set in the Fabrication panel.`}</p>
</section>
