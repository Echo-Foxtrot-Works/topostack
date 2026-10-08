<script lang="ts">
  import { ChevronDown, Droplets, Grid3X3, Layers3, Puzzle, SprayCan, Waves } from "@lucide/svelte";
  import { Section } from "@loidolt/theme-svelte";
  import { DEFAULT_WATER_INSERT_CLEARANCE_MM, displayLength, MAX_PROJECT_DIMENSION_MM, MAX_SEAM_OFFSET_MM, type WaterInsertSettingsV1 } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { insertLakes } from "$lib/studio/preview-summary";

  const studio = getStudio();
  const { sectionSummary, shownLength, storedLength, toggleSection, updateFabrication, workAreaLength } = studio;
  const inserts = $derived(studio.project.waterInserts);
  const insertThicknessMm = $derived(inserts?.thicknessMm ?? studio.project.materialThicknessMm);
  const insertLakeRows = $derived(inserts ? insertLakes(studio.geometry, studio.project) : []);
  let showAllInsertLakes = $state(false);
  const updateInserts = (patch: Partial<WaterInsertSettingsV1>) => inserts && void updateFabrication({ waterInserts: { ...inserts, ...patch } });
  const setLakeInsert = (key: string, on: boolean) => {
    if (!inserts) return;
    const excluded = new Set(inserts.excludedLakeIds);
    if (on) excluded.delete(key);
    else excluded.add(key);
    updateInserts({ excludedLakeIds: [...excluded].sort() });
  };
</script>

<Section class="config-section advanced-section" aria-labelledby="atomm-advanced-title">
  <button type="button" class="section-disclosure" id="atomm-advanced-title" aria-expanded={studio.openSections.advanced} aria-controls="section-advanced" onclick={() => toggleSection("advanced")}>
    <span class="section-number">07</span>
    <span class="section-title">{studio.project.outputMode === "engraving" ? "Artwork settings" : "Fabrication settings"}<small>{sectionSummary("advanced")}</small></span>
    <ChevronDown size={16} class={studio.openSections.advanced ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
  </button>
  <div id="section-advanced" class="section-content" hidden={!studio.openSections.advanced}>
    <div class="advanced-fields">
      <div class="toggle-stack">
        {#if studio.project.outputMode === "stack"}<Switch checked={studio.project.optimizeMaterialUse} onCheckedChange={(optimizeMaterialUse) => void updateFabrication({ optimizeMaterialUse })} aria-label="Material-saving nests"><span class="toggle-label"><Layers3 size={16} />Material-saving nests</span></Switch>{/if}
        {#if studio.project.outputMode === "stack" && studio.seamGrid}<Switch checked={studio.project.showAssemblyLabels} onCheckedChange={(showAssemblyLabels) => void updateFabrication({ showAssemblyLabels })} aria-label="Assembly labels"><span class="toggle-label"><Grid3X3 size={16} />Assembly labels</span></Switch>{/if}
        {#if studio.project.outputMode === "stack" && studio.seamGrid}<Switch checked={studio.project.seamTabs} onCheckedChange={(seamTabs) => void updateFabrication({ seamTabs })} aria-label="Puzzle seam tabs"><span class="toggle-label"><Puzzle size={16} />Puzzle seam tabs</span></Switch>{/if}
        {#if studio.project.outputMode === "stack"}<Switch checked={studio.project.paintTemplates.includes("water")} onCheckedChange={(on) => void updateFabrication({ paintTemplates: on ? ["water"] : [] })} aria-label="Water paint templates"><span class="toggle-label"><SprayCan size={16} />Water paint templates</span></Switch>{/if}
        {#if studio.project.outputMode === "stack"}<Switch checked={Boolean(inserts)} disabled={!studio.project.showWaterDepth && !inserts} onCheckedChange={(on) => void updateFabrication({ waterInserts: on ? { fitClearanceMm: DEFAULT_WATER_INSERT_CLEARANCE_MM, excludedLakeIds: [] } : undefined })} aria-label="Acrylic water inserts"><span class="toggle-label"><Droplets size={16} />Acrylic water inserts</span></Switch>{/if}
        <Switch checked={studio.project.smoothing === 1} onCheckedChange={(smooth) => void updateFabrication({ smoothing: smooth ? 1 : 0 })} aria-label="Smooth contours"><span class="toggle-label"><Waves size={16} />Smooth contours</span></Switch>
      </div>
      {#if studio.project.outputMode === "stack" && !studio.project.showWaterDepth}<small class="depth-note insert-note">Acrylic water inserts need <strong>Water depth</strong> on: they replace each lake on the sheet that carries its waterline.</small>{/if}
      {#if studio.project.outputMode === "stack" && inserts}
        <div class="toggle-settings water-insert-settings">
          <p class="subgroup-heading">Acrylic</p>
          <div class="field-stack">
            <LengthField label="Acrylic thickness" unit={studio.shownLengthUnit} value={shownLength(insertThicknessMm)} min={shownLength(0.5)} max={shownLength(25)} step={studio.project.units === "imperial" ? 0.01 : 0.1} onCommit={(shown) => { const thicknessMm = storedLength(shown); if (thicknessMm !== insertThicknessMm) updateInserts({ thicknessMm }); }} />
            <LengthField label="Acrylic kerf" unit={studio.shownLengthUnit} value={shownLength(inserts.kerfMm ?? studio.project.laserKerfMm)} min={0} max={shownLength(1)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onCommit={(shown) => { const kerfMm = storedLength(shown); if (kerfMm !== (inserts.kerfMm ?? studio.project.laserKerfMm)) updateInserts({ kerfMm }); }} />
            <LengthField label="Fit clearance" unit={studio.shownLengthUnit} value={shownLength(inserts.fitClearanceMm)} min={0} max={shownLength(0.5)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onCommit={(shown) => { const fitClearanceMm = storedLength(shown); if (fitClearanceMm !== inserts.fitClearanceMm) updateInserts({ fitClearanceMm }); }} />
          </div>
          {#if insertThicknessMm > studio.project.materialThicknessMm}<small class="depth-note">Thicker than the wood: the water will stand {shownLength(insertThicknessMm - studio.project.materialThicknessMm)} {studio.shownLengthUnit} proud of its shore.</small>{/if}
          {#if insertLakeRows.length}
            <p class="subgroup-heading">Lakes</p>
            <div class="toggle-stack insert-lakes">
              {#each showAllInsertLakes ? insertLakeRows : insertLakeRows.slice(0, 8) as lake (lake.key)}
                <Switch checked={!lake.excluded} onCheckedChange={(on) => setLakeInsert(lake.key, on)} aria-label={`Acrylic insert for ${lake.name}`}><span class="toggle-label">{lake.name}<small>{lake.excluded ? "Wood" : lake.insertIds.length ? lake.insertIds.join(", ") : "Stays wood"}</small></span></Switch>
              {/each}
            </div>
            {#if insertLakeRows.length > 8}<p class="depth-chart-row"><button type="button" onclick={() => showAllInsertLakes = !showAllInsertLakes}>{showAllInsertLakes ? "Show fewer lakes" : `Show all ${insertLakeRows.length} lakes`}</button></p>{/if}
          {/if}
          <small class="depth-note">Each lake is cut out of the sheet at its waterline and filled with a fitted acrylic piece, exported as separate files. A 2 mm ledge on the sheet below holds it.</small>
        </div>
      {/if}
      <div class="field-stack">
        {#if studio.project.outputMode === "stack" && studio.project.optimizeMaterialUse}<LengthField label="Glue margin" unit={studio.shownLengthUnit} value={shownLength(studio.project.glueMarginMm)} min={shownLength(2)} max={shownLength(25)} step={studio.project.units === "imperial" ? 0.01 : 0.5} onCommit={(shown) => { const glueMarginMm = storedLength(shown); if (glueMarginMm !== studio.project.glueMarginMm) void updateFabrication({ glueMarginMm }); }} />{/if}
        {#if studio.project.outputMode === "stack"}<LengthField label="Laser kerf" unit={studio.shownLengthUnit} value={shownLength(studio.project.laserKerfMm)} min={0} max={shownLength(1)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onCommit={(shown) => { const laserKerfMm = storedLength(shown); if (laserKerfMm !== studio.project.laserKerfMm) void updateFabrication({ laserKerfMm }); }} />{/if}
        <LengthField label="Minimum feature" unit={studio.shownLengthUnit} value={shownLength(studio.project.minimumFeatureMm)} min={shownLength(0.2)} max={shownLength(5)} step={studio.project.units === "imperial" ? 0.01 : 0.1} onCommit={(shown) => { const minimumFeatureMm = storedLength(shown); if (minimumFeatureMm !== studio.project.minimumFeatureMm) void updateFabrication({ minimumFeatureMm }); }} />
        {#if studio.project.outputMode === "stack"}<LengthField label="Work area width" unit={studio.shownLengthUnit} value={shownLength(studio.project.workAreaWidthMm)} min={0} max={displayLength(MAX_PROJECT_DIMENSION_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.1 : 1} onCommit={(shown) => { const workAreaWidthMm = workAreaLength(shown); if (workAreaWidthMm !== studio.project.workAreaWidthMm) void updateFabrication({ workAreaWidthMm }); }} />{/if}
        {#if studio.project.outputMode === "stack"}<LengthField label="Work area height" unit={studio.shownLengthUnit} value={shownLength(studio.project.workAreaHeightMm)} min={0} max={displayLength(MAX_PROJECT_DIMENSION_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.1 : 1} onCommit={(shown) => { const workAreaHeightMm = workAreaLength(shown); if (workAreaHeightMm !== studio.project.workAreaHeightMm) void updateFabrication({ workAreaHeightMm }); }} />{/if}
        {#if studio.project.outputMode === "stack" && studio.seamGrid}<LengthField label="Seam offset" unit={studio.shownLengthUnit} value={shownLength(studio.project.seamOffsetMm)} min={0} max={shownLength(MAX_SEAM_OFFSET_MM)} step={studio.project.units === "imperial" ? 0.01 : 1} onCommit={(shown) => { const seamOffsetMm = storedLength(shown); if (seamOffsetMm !== studio.project.seamOffsetMm) void updateFabrication({ seamOffsetMm }); }} />{/if}
      </div>
      {#if studio.project.outputMode === "stack"}<p class="seam-summary">{studio.seamSummary}</p>{/if}
    </div>
  </div>
</Section>
