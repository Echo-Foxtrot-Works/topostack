<script lang="ts">
  import { Grid3X3, Layers3, Puzzle } from "@lucide/svelte";
  import { MAX_SEAM_OFFSET_MM } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

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
    <p id="nests-and-seams-title" class="subgroup-heading">{t("terrain.panelsAndSeams")}</p>
  {:else}
    <header class="sheet-layout-header">
      <span class="export-row-icon"><Puzzle size={20} strokeWidth={1.6} /></span>
      <div><h3 id="nests-and-seams-title">{t("terrain.panelsAndSeams")}</h3><p>{t("terrain.panelsAndSeamsDescription")}</p></div>
    </header>
  {/if}
  <div class="toggle-stack">
    <Switch checked={studio.project.optimizeMaterialUse} {disabled} onCheckedChange={(optimizeMaterialUse) => void updateFabrication({ optimizeMaterialUse })} aria-label={t("terrain.materialSavingNests")}><span class="toggle-label"><Layers3 size={16} />{t("terrain.materialSavingNests")}</span></Switch>
    {#if studio.project.optimizeMaterialUse}
      <div class="toggle-settings">
        <div class="field-stack"><LengthField label={t("terrain.glueMargin")} unit={studio.shownLengthUnit} value={shownLength(studio.project.glueMarginMm)} min={shownLength(2)} max={shownLength(25)} step={studio.project.units === "imperial" ? 0.01 : 0.5} {disabled} onCommit={(shown) => { const glueMarginMm = storedLength(shown); if (glueMarginMm !== studio.project.glueMarginMm) void updateFabrication({ glueMarginMm }); }} /></div>
        <small class="depth-note">{t("terrain.glueMarginHint")}</small>
      </div>
    {/if}
    {#if studio.seamGrid}
      <Switch checked={studio.project.seamTabs} {disabled} onCheckedChange={(seamTabs) => void updateFabrication({ seamTabs })} aria-label={t("terrain.puzzleSeamTabs")}><span class="toggle-label"><Puzzle size={16} />{t("terrain.puzzleSeamTabs")}</span></Switch>
      <Switch checked={studio.project.showAssemblyLabels} {disabled} onCheckedChange={(showAssemblyLabels) => void updateFabrication({ showAssemblyLabels })} aria-label={t("terrain.assemblyLabels")}><span class="toggle-label"><Grid3X3 size={16} />{t("terrain.assemblyLabels")}</span></Switch>
      <div class="field-stack"><LengthField label={t("terrain.seamOffset")} unit={studio.shownLengthUnit} value={shownLength(studio.project.seamOffsetMm)} min={0} max={shownLength(MAX_SEAM_OFFSET_MM)} step={studio.project.units === "imperial" ? 0.01 : 1} {disabled} onCommit={(shown) => { const seamOffsetMm = storedLength(shown); if (seamOffsetMm !== studio.project.seamOffsetMm) void updateFabrication({ seamOffsetMm }); }} /></div>
    {/if}
  </div>
  <p class="seam-summary">{studio.embeddedInPlatform ? studio.seamSummary : t("terrain.seamSummaryWorkArea", { summary: studio.seamSummary })}</p>
</section>
