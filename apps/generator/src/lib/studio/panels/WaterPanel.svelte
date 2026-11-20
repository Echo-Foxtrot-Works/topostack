<script lang="ts">
  import { withPaintKind } from "$lib/studio/paint-colors";
  import { Droplets, SprayCan, Waves } from "@lucide/svelte";
  import { Field } from "@loidolt/theme-svelte";
  import { DEFAULT_WATER_INSERT_CLEARANCE_MM, displayElevation, MAX_WATER_DEPTH_EXAGGERATION, MIN_WATER_DEPTH_EXAGGERATION, type WaterInsertSettingsV1 } from "@topostack/core";
  import FeedbackButton from "$lib/site/FeedbackButton.svelte";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { WATER_FILL_PATTERNS } from "$lib/studio/options";
  import { insertLakes } from "$lib/studio/preview-summary";
  import LakeDepthHelp from "$lib/studio/panels/LakeDepthHelp.svelte";
  import LineWidthField from "$lib/studio/panels/LineWidthField.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { openCustomDataSection } from "$lib/studio/customdata/custom-data-nav.svelte";
  import { formatNumber, t, type MessageKey } from "$lib/i18n/i18n.svelte";

  /** Everything about lakes and sea: shorelines, carved depth, acrylic inserts and paint stencils. */
  let { openLakeDepthHelp }: { openLakeDepthHelp?: (trigger: HTMLButtonElement) => void } = $props();
  const studio = getStudio();
  const { getFeedbackContext, navigateChoice, setLakeDepth, shownDepth, shownLength, storedLength, updateDepthLayerLimit, updateFabrication, updateMapDetails } = studio;
  const stack = $derived(studio.project.outputMode === "stack");
  /** A lake carved from the maker's own chart; its modeled maximum no longer applies. */
  const charted = (hylakId: number): boolean => studio.project.userDepthCharts?.[String(hylakId)] !== undefined;
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
  // The setting's name is bold inside the sentence; a marker splits the translated text around it.
  const insertsNeedDepth = $derived(t("water.insertsNeedDepth", { setting: "\u0000" }).split("\u0000"));
</script>

<PanelFrame id="water" title={t("water.title")} class="water-panel">
  <div class="detail-group">
    <p class="subgroup-heading">{t("water.shorelines")}</p>
    <div class="toggle-stack">
      <div class="toggle-control">
        <Switch checked={studio.project.showWater} onCheckedChange={(showWater) => void updateMapDetails({ showWater })} aria-label={t("water.waterOutlines")}><span class="toggle-label"><Waves size={16} />{t("water.waterOutlines")}</span></Switch>
        {#if studio.project.showWater}
          <div class="toggle-settings">
            <div class="field-stack"><LineWidthField label={t("water.lineWidthShort")} fieldLabel={t("water.lineWidth")} key="waterMm" /></div>
            {#if !stack}
              <p class="subgroup-heading">{t("water.fill")}</p>
              <div class="ldt-toggle-group water-pattern-options" role="radiogroup" aria-label={t("water.fillPattern")}>
                {#each WATER_FILL_PATTERNS as option}
                  <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.project.waterFillPattern === option.value} data-state={studio.project.waterFillPattern === option.value ? "on" : "off"} tabindex={studio.project.waterFillPattern === option.value ? 0 : -1} onclick={() => void updateFabrication({ waterFillPattern: option.value })} onkeydown={navigateChoice}>{t(`water.fillPatternOption.${option.value}` as MessageKey)}</button>
                {/each}
              </div>
              <small class="depth-note">{t("water.fillNote")}</small>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if stack}
  <div class="detail-group">
    <p class="subgroup-heading">{t("water.depth")}</p>
    <div class="toggle-stack">
      <div class="toggle-control">
        <Switch checked={studio.project.showWaterDepth} onCheckedChange={(showWaterDepth) => void updateMapDetails({ showWaterDepth })} aria-label={t("water.waterDepth")}><span class="toggle-label"><Waves size={16} />{t("water.waterDepth")}</span></Switch>
        {#if studio.project.showWaterDepth}
          <div class="toggle-settings">
            <div class="range-field">
              <span class="range-field__label"><b>{t("water.depthExaggeration")}</b></span>
              <div class="range-field__row">
                <input type="range" aria-label={t("water.depthExaggerationSlider")} min={MIN_WATER_DEPTH_EXAGGERATION} max={MAX_WATER_DEPTH_EXAGGERATION} step="0.05" value={studio.project.waterDepthExaggeration} oninput={(event) => void updateFabrication({ waterDepthExaggeration: Number(event.currentTarget.value) })} />
                <span class="number-input number-input--compact"><NumberField label={t("water.depthExaggerationField")} value={studio.project.waterDepthExaggeration} min={MIN_WATER_DEPTH_EXAGGERATION} max={MAX_WATER_DEPTH_EXAGGERATION} step={0.05} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ waterDepthExaggeration: event.currentTarget.valueAsNumber })} onValueChange={(value) => value !== studio.project.waterDepthExaggeration && void updateFabrication({ waterDepthExaggeration: value })} /><em>×</em></span>
              </div>
              <small><span>{t("water.exaggerationMin", { value: MIN_WATER_DEPTH_EXAGGERATION })}</span><span>{t("water.exaggerationMaxTerrain", { value: MAX_WATER_DEPTH_EXAGGERATION })}</span></small>
            </div>
            <small class="depth-note">{t("water.depthExaggerationNote")}</small>
            <Switch checked={studio.project.waterDepthLayerLimit !== undefined} onCheckedChange={(limited) => void updateFabrication({ waterDepthLayerLimit: limited ? Math.max(1, studio.stackPlan.depthLayerCount) : undefined, fitLakeDepth: false })} aria-label={t("water.limitDepthLayers")}><span class="toggle-label">{t("water.limitDepthLayers")}</span></Switch>
            {#if studio.project.waterDepthLayerLimit !== undefined}
              <Field label={t("water.depthLayers")} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("water.maxDepthLayers")} value={studio.project.waterDepthLayerLimit} min={1} step={1} oninput={(event) => event.currentTarget.value !== "" && updateDepthLayerLimit(event.currentTarget.valueAsNumber)} onValueChange={updateDepthLayerLimit} /></span>{/snippet}</Field>
              <small class="depth-note">{t("water.depthLayersLimited", { count: studio.project.waterDepthLayerLimit, depth: shownLength(studio.project.waterDepthLayerLimit * studio.project.materialThicknessMm), unit: studio.shownLengthUnit })}</small>
              <Switch checked={studio.project.fitLakeDepth} onCheckedChange={(fitLakeDepth) => void updateFabrication({ fitLakeDepth })} aria-label={t("water.fitLakeDepth")}><span class="toggle-label">{t("water.fitLakeDepth")}</span></Switch>
              <small class="depth-note">{t("water.fitLakeDepthNote")}</small>
            {:else}
              <small class="depth-note">{t("water.depthLayersAutomatic", { count: studio.stackPlan.depthLayerCount, depth: shownLength(studio.stackPlan.depthLayerCount * studio.project.materialThicknessMm), unit: studio.shownLengthUnit })}</small>
            {/if}
            {#each studio.geometry.waterSurfaces.filter((lake) => lake.depthFitScale !== undefined) as lake (lake.id)}
              <small class="depth-note">{t("water.lakeDepthFitted", { name: lake.name ?? t("water.lakeFallbackName"), exaggeration: formatNumber(lake.appliedDepthExaggeration!, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), percent: Math.round(lake.depthFitScale! * 100) })}</small>
            {/each}
          </div>
        {/if}
        {#if studio.project.showWaterDepth && (studio.activeSource.bathymetryStatus === "available" || studio.activeSource.bathymetryStatus === "partial")}
          <small class="depth-note">{t("water.surveyedNote")}</small>
        {/if}
        {#if studio.project.showWaterDepth && studio.modeledLakes.length}
          <div class="toggle-settings">
            <div class="subgroup-heading subgroup-heading--action">
              <p>{t("water.maximumDepth")}</p>
              {#if studio.hasDepthOverride}<button type="button" onclick={() => void updateFabrication({ waterDepthOverrides: {} })}>{t("water.reset")}</button>{/if}
            </div>
            <div class="field-stack">
              {#each studio.modeledLakes as lake (lake.id)}
                <Field label={lake.name} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("water.lakeMaximumDepth", { name: lake.name })} value={shownDepth(lake.maxDepthM)} min={1} max={Math.round(displayElevation(12000, studio.project.units))} onValueChange={(depth) => void setLakeDepth(lake.hylakId, depth)} disabled={charted(lake.hylakId)} /><em>{studio.shownElevationUnit}</em></span>{/snippet}</Field>
                <p class="depth-chart-row">
                  {#if charted(lake.hylakId)}
                    <span>{t("water.depthChartInUse")}</span>
                    <button type="button" onclick={() => void studio.clearDepthChart(String(lake.hylakId))}>{t("water.stopUsingDepthChart")}</button>
                  {:else if !studio.embeddedInPlatform}
                    <!-- Charts are built in their own view; this only points there. The platform embed has no such view. -->
                    <button type="button" onclick={() => { openCustomDataSection("charts"); studio.mode = "custom"; }}>{t("water.useDepthChart")}</button>
                  {/if}
                </p>
              {/each}
            </div>
            <small class="depth-note">{studio.embeddedInPlatform ? t("water.modeledNote") : t("water.modeledNoteWithChart")}</small>
          </div>
        {/if}
        <div class="depth-note">{#if !studio.embeddedInPlatform}<FeedbackButton label={t("water.reportLakeData")} type="lake" getContext={getFeedbackContext} />{/if} <LakeDepthHelp {openLakeDepthHelp} /></div>
      </div>
    </div>
  </div>

  <div class="detail-group">
    <p class="subgroup-heading">{t("water.insertsAndPaint")}</p>
    <div class="toggle-stack">
      <Switch checked={Boolean(inserts)} disabled={!studio.project.showWaterDepth && !inserts} onCheckedChange={(on) => void updateFabrication({ waterInserts: on ? { fitClearanceMm: DEFAULT_WATER_INSERT_CLEARANCE_MM, excludedLakeIds: [] } : undefined })} aria-label={t("water.acrylicInserts")}><span class="toggle-label"><Droplets size={16} />{t("water.acrylicInserts")}</span></Switch>
      <Switch checked={studio.project.paintTemplates.includes("water")} onCheckedChange={(on) => void updateFabrication({ paintTemplates: withPaintKind(studio.project.paintTemplates, "water", on) })} aria-label={t("water.paintTemplates")}><span class="toggle-label"><SprayCan size={16} />{t("water.paintTemplates")}</span></Switch>
    </div>
    {#if !studio.project.showWaterDepth}<small class="depth-note insert-note">{#each insertsNeedDepth as part, index}{#if index}<strong>{t("water.waterDepth")}</strong>{/if}{part}{/each}</small>{/if}
    {#if inserts}
      <div class="toggle-settings water-insert-settings">
        <p class="subgroup-heading">{t("water.acrylic")}</p>
        <div class="field-stack">
          <LengthField label={t("water.acrylicThickness")} unit={studio.shownLengthUnit} value={shownLength(insertThicknessMm)} min={shownLength(0.5)} max={shownLength(25)} step={studio.project.units === "imperial" ? 0.01 : 0.1} onCommit={(shown) => { const thicknessMm = storedLength(shown); if (thicknessMm !== insertThicknessMm) updateInserts({ thicknessMm }); }} />
          <LengthField label={t("water.acrylicKerf")} unit={studio.shownLengthUnit} value={shownLength(inserts.kerfMm ?? studio.project.laserKerfMm)} min={0} max={shownLength(1)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onCommit={(shown) => { const kerfMm = storedLength(shown); if (kerfMm !== (inserts.kerfMm ?? studio.project.laserKerfMm)) updateInserts({ kerfMm }); }} />
          <LengthField label={t("water.fitClearance")} unit={studio.shownLengthUnit} value={shownLength(inserts.fitClearanceMm)} min={0} max={shownLength(0.5)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onCommit={(shown) => { const fitClearanceMm = storedLength(shown); if (fitClearanceMm !== inserts.fitClearanceMm) updateInserts({ fitClearanceMm }); }} />
        </div>
        {#if insertThicknessMm > studio.project.materialThicknessMm}<small class="depth-note">{t("water.insertProud", { height: shownLength(insertThicknessMm - studio.project.materialThicknessMm), unit: studio.shownLengthUnit })}</small>{/if}
        {#if insertLakeRows.length}
          <p class="subgroup-heading">{t("water.lakes")}</p>
          <div class="toggle-stack insert-lakes">
            {#each showAllInsertLakes ? insertLakeRows : insertLakeRows.slice(0, 8) as lake (lake.key)}
              <Switch checked={!lake.excluded} onCheckedChange={(on) => setLakeInsert(lake.key, on)} aria-label={t("water.insertForLake", { name: lake.name })}><span class="toggle-label">{lake.name}<small>{lake.excluded ? t("water.lakeWood") : lake.insertIds.length ? lake.insertIds.join(", ") : t("water.lakeStaysWood")}</small></span></Switch>
            {/each}
          </div>
          {#if insertLakeRows.length > 8}<p class="depth-chart-row"><button type="button" onclick={() => showAllInsertLakes = !showAllInsertLakes}>{showAllInsertLakes ? t("water.showFewerLakes") : t("water.showAllLakes", { count: insertLakeRows.length })}</button></p>{/if}
        {/if}
        <small class="depth-note">{t("water.insertsNote")}</small>
      </div>
    {/if}
  </div>
  {/if}
</PanelFrame>
