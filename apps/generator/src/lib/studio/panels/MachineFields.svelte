<script lang="ts">
  import { displayLength, MAX_PROJECT_DIMENSION_MM } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  /** What the laser can do: kerf, smallest feature and work area; shared by the Fabricate panel and the setup guide. */
  const studio = getStudio();
  const { shownLength, storedLength, updateFabrication, workAreaLength } = studio;
  const stack = $derived(studio.project.outputMode === "stack");
</script>

<div class="field-stack">
  {#if stack}<LengthField label={t("terrain.laserKerf")} unit={studio.shownLengthUnit} value={shownLength(studio.project.laserKerfMm)} min={0} max={shownLength(1)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onCommit={(shown) => { const laserKerfMm = storedLength(shown); if (laserKerfMm !== studio.project.laserKerfMm) void updateFabrication({ laserKerfMm }); }} />{/if}
  <LengthField label={t("terrain.minimumFeature")} unit={studio.shownLengthUnit} value={shownLength(studio.project.minimumFeatureMm)} min={shownLength(0.2)} max={shownLength(5)} step={studio.project.units === "imperial" ? 0.01 : 0.1} onCommit={(shown) => { const minimumFeatureMm = storedLength(shown); if (minimumFeatureMm !== studio.project.minimumFeatureMm) void updateFabrication({ minimumFeatureMm }); }} />
  {#if stack}<LengthField label={t("terrain.workAreaWidth")} unit={studio.shownLengthUnit} value={shownLength(studio.project.workAreaWidthMm)} min={0} max={displayLength(MAX_PROJECT_DIMENSION_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.1 : 1} onCommit={(shown) => { const workAreaWidthMm = workAreaLength(shown); if (workAreaWidthMm !== studio.project.workAreaWidthMm) void updateFabrication({ workAreaWidthMm }); }} />{/if}
  {#if stack}<LengthField label={t("terrain.workAreaHeight")} unit={studio.shownLengthUnit} value={shownLength(studio.project.workAreaHeightMm)} min={0} max={displayLength(MAX_PROJECT_DIMENSION_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.1 : 1} onCommit={(shown) => { const workAreaHeightMm = workAreaLength(shown); if (workAreaHeightMm !== studio.project.workAreaHeightMm) void updateFabrication({ workAreaHeightMm }); }} />{/if}
</div>
{#if stack}<p class="seam-summary">{studio.seamSummary}</p>{/if}
