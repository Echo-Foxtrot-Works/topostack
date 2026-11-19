<script lang="ts">
  import { Mountain, PenTool, Waves } from "@lucide/svelte";
  import { Field } from "@loidolt/theme-svelte";
  import { displayElevation, MAX_VERTICAL_EXAGGERATION, MIN_VERTICAL_EXAGGERATION } from "@topostack/core";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import LineWidthField from "$lib/studio/panels/LineWidthField.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { formatNumber, t } from "$lib/i18n/i18n.svelte";

  const studio = getStudio();
  const { shownLength, storedLength, updateFabrication, updateVerticalExaggeration } = studio;
</script>

<!-- The relief itself: how many layers or contour lines, and how they are shaped. -->
<PanelFrame id="terrain" title={studio.project.outputMode === "engraving" ? t("terrain.contourDesign") : t("terrain.terrainLayers")}>
<div class="detail-group terrain-group">
  {#if studio.project.outputMode === "engraving"}
    <div class="toggle-stack">
      <Switch checked={studio.project.showEngravingContours} onCheckedChange={(showEngravingContours) => void updateFabrication({ showEngravingContours })} aria-label={t("terrain.contourLines")}><span class="toggle-label"><PenTool size={16} />{t("terrain.contourLines")}</span></Switch>
    </div>
    {#if studio.project.showEngravingContours}
    <div class="range-field">
      <span class="range-field__label"><b>{t("terrain.contourDensity")}</b></span>
      <div class="range-field__row">
        <input type="range" aria-label={t("terrain.contourDensitySlider")} min="4" max="40" step="1" value={studio.project.engravingContourCount} oninput={(event) => void updateFabrication({ engravingContourCount: Number(event.currentTarget.value) })} />
        <span class="number-input number-input--compact"><NumberField label={t("terrain.contourDensity")} value={studio.project.engravingContourCount} min={4} max={40} step={1} onValueChange={(value) => value !== studio.project.engravingContourCount && void updateFabrication({ engravingContourCount: value })} /><em>{t("terrain.linesUnit")}</em></span>
      </div>
      <small><span>{t("terrain.densitySparse", { count: 4 })}</span><span>{t("terrain.densityDetailed", { count: 40 })}</span></small>
    </div>
    <div class="field-stack">
      <Field label={t("terrain.indexContour")} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("terrain.indexContourInterval")} value={studio.project.engravingIndexInterval} min={2} max={10} step={1} onValueChange={(value) => value !== studio.project.engravingIndexInterval && void updateFabrication({ engravingIndexInterval: value })} /><em>{t("terrain.everyUnit")}</em></span>{/snippet}</Field>
    </div>
    <div class="relief-summary">
      <PenTool size={20} />
      <span>
        <strong>{t("terrain.engravingSummary", { count: studio.project.engravingContourCount })}</strong>
        <small>{t("terrain.engravingSummaryDetail", { distance: Math.round(displayElevation(studio.contourInterval, studio.project.units)), unit: studio.shownElevationUnit, interval: studio.project.engravingIndexInterval })}</small>
      </span>
    </div>
    {:else}
    <div class="relief-summary">
      <PenTool size={20} />
      <span>
        <strong>{t("terrain.noContourLines")}</strong>
        <small>{t("terrain.noContourLinesDetail")}</small>
      </span>
    </div>
    {/if}
  {:else}
  <div class="range-field">
    <span class="range-field__label vertical-exaggeration-heading"><b>{t("terrain.verticalExaggeration")}</b><span class="terrain-data-badge">{t("terrain.updatesAutomatically")}</span></span>
    <div class="range-field__row">
      <input type="range" aria-label={t("terrain.verticalExaggerationSlider")} min={MIN_VERTICAL_EXAGGERATION} max={MAX_VERTICAL_EXAGGERATION} step="0.1" value={studio.project.verticalExaggeration} oninput={(event) => updateVerticalExaggeration(Number(event.currentTarget.value))} />
      <span class="number-input number-input--compact"><NumberField label={t("terrain.verticalExaggeration")} value={studio.project.verticalExaggeration} min={MIN_VERTICAL_EXAGGERATION} max={MAX_VERTICAL_EXAGGERATION} step={0.1} oninput={(event) => event.currentTarget.value !== "" && updateVerticalExaggeration(event.currentTarget.valueAsNumber)} onValueChange={updateVerticalExaggeration} /><em>×</em></span>
    </div>
    <small><span>{t("terrain.exaggerationValue", { value: MIN_VERTICAL_EXAGGERATION })}</span><span>{t("terrain.exaggerationValue", { value: MAX_VERTICAL_EXAGGERATION })}</span></small>
  </div>
  <div class="field-stack">
    <LengthField label={t("terrain.material")} fieldLabel={t("terrain.materialThickness")} unit={studio.shownLengthUnit} value={shownLength(studio.project.materialThicknessMm)} min={shownLength(0.5)} max={shownLength(25)} step={studio.project.units === "imperial" ? 0.01 : 0.1} onCommit={(shown) => { const materialThicknessMm = storedLength(shown); if (materialThicknessMm !== studio.project.materialThicknessMm) void updateFabrication({ materialThicknessMm }); }} />
  </div>
  <div class="relief-summary">
    <Mountain size={20} />
    <span>
      <strong>{t("terrain.reliefSummary", { relief: Math.round(displayElevation(studio.geometry.maxElevationM - studio.geometry.minElevationM, studio.project.units)), elevationUnit: studio.shownElevationUnit, layers: studio.stackLayerCount, height: shownLength(studio.stackLayerCount * studio.project.materialThicknessMm), lengthUnit: studio.shownLengthUnit })}</strong>
      <small>{studio.stackPlan.horizontalScale > 0 ? t("terrain.reliefDetailWithScale", { exaggeration: formatNumber(studio.stackPlan.verticalExaggeration, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), scale: Math.round(1 / studio.stackPlan.horizontalScale), perLayer: Math.round(displayElevation(studio.stackPlan.metersPerLayer, studio.project.units)), unit: studio.shownElevationUnit }) : t("terrain.reliefDetail", { exaggeration: formatNumber(studio.stackPlan.verticalExaggeration, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), perLayer: Math.round(displayElevation(studio.stackPlan.metersPerLayer, studio.project.units)), unit: studio.shownElevationUnit })}</small>
      {#if Math.abs(studio.stackPlan.verticalExaggeration - studio.project.verticalExaggeration) > 0.05}
        <small>{t("terrain.exaggerationRounding")}</small>
      {/if}
    </span>
  </div>
  {/if}
</div>
{#if studio.project.outputMode !== "engraving" || studio.project.showEngravingContours}
<div class="detail-group">
  <p class="subgroup-heading">{t("terrain.contourShape")}</p>
  <div class="toggle-stack">
    <Switch checked={studio.project.smoothing === 1} onCheckedChange={(smooth) => void updateFabrication({ smoothing: smooth ? 1 : 0 })} aria-label={t("terrain.smoothContours")}><span class="toggle-label"><Waves size={16} />{t("terrain.smoothContours")}</span></Switch>
  </div>
  {#if studio.project.outputMode === "engraving"}
    <div class="field-stack">
      <LineWidthField label={t("terrain.minorContours")} fieldLabel={t("terrain.minorContourWidth")} key="contourMm" />
      <LineWidthField label={t("terrain.indexContours")} fieldLabel={t("terrain.indexContourWidth")} key="indexContourMm" />
    </div>
  {/if}
</div>
{/if}
</PanelFrame>
