<script lang="ts">
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
</script>

<PanelFrame id="water" title="Water" class="water-panel">
  <div class="detail-group">
    <p class="subgroup-heading">Shorelines</p>
    <div class="toggle-stack">
      <div class="toggle-control">
        <Switch checked={studio.project.showWater} onCheckedChange={(showWater) => void updateMapDetails({ showWater })} aria-label="Water outlines"><span class="toggle-label"><Waves size={16} />Water outlines</span></Switch>
        {#if studio.project.showWater}
          <div class="toggle-settings">
            <div class="field-stack"><LineWidthField label="Width" fieldLabel="Water line width" key="waterMm" /></div>
            {#if !stack}
              <p class="subgroup-heading">Water fill</p>
              <div class="ldt-toggle-group water-pattern-options" role="radiogroup" aria-label="Water fill pattern">
                {#each WATER_FILL_PATTERNS as option}
                  <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.project.waterFillPattern === option.value} data-state={studio.project.waterFillPattern === option.value ? "on" : "off"} tabindex={studio.project.waterFillPattern === option.value ? 0 : -1} onclick={() => void updateFabrication({ waterFillPattern: option.value })} onkeydown={navigateChoice}>{option.label}</button>
                {/each}
              </div>
              <small class="depth-note">Adds fabrication-ready vector marks inside water areas. None keeps outlines only.</small>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  </div>

  {#if stack}
  <div class="detail-group">
    <p class="subgroup-heading">Depth</p>
    <div class="toggle-stack">
      <div class="toggle-control">
        <Switch checked={studio.project.showWaterDepth} onCheckedChange={(showWaterDepth) => void updateMapDetails({ showWaterDepth })} aria-label="Water depth"><span class="toggle-label"><Waves size={16} />Water depth</span></Switch>
        {#if studio.project.showWaterDepth}
          <div class="toggle-settings">
            <div class="range-field">
              <span class="range-field__label"><b>Depth exaggeration</b></span>
              <div class="range-field__row">
                <input type="range" aria-label="Water depth exaggeration slider" min={MIN_WATER_DEPTH_EXAGGERATION} max={MAX_WATER_DEPTH_EXAGGERATION} step="0.05" value={studio.project.waterDepthExaggeration} oninput={(event) => void updateFabrication({ waterDepthExaggeration: Number(event.currentTarget.value) })} />
                <span class="number-input number-input--compact"><NumberField label="Water depth exaggeration" value={studio.project.waterDepthExaggeration} min={MIN_WATER_DEPTH_EXAGGERATION} max={MAX_WATER_DEPTH_EXAGGERATION} step={0.05} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ waterDepthExaggeration: event.currentTarget.valueAsNumber })} onValueChange={(value) => value !== studio.project.waterDepthExaggeration && void updateFabrication({ waterDepthExaggeration: value })} /><em>×</em></span>
              </div>
              <small><span>{MIN_WATER_DEPTH_EXAGGERATION}×</span><span>{MAX_WATER_DEPTH_EXAGGERATION}× terrain</span></small>
            </div>
            <small class="depth-note">Relative to the terrain's vertical scale, which water already follows. 1× keeps lakes and sea floor on the same scale as the hills.</small>
            <Switch checked={studio.project.waterDepthLayerLimit !== undefined} onCheckedChange={(limited) => void updateFabrication({ waterDepthLayerLimit: limited ? Math.max(1, studio.stackPlan.depthLayerCount) : undefined, fitLakeDepth: false })} aria-label="Limit depth layers"><span class="toggle-label">Limit depth layers</span></Switch>
            {#if studio.project.waterDepthLayerLimit !== undefined}
              <Field label="Depth layers" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Maximum depth layers" value={studio.project.waterDepthLayerLimit} min={1} step={1} oninput={(event) => event.currentTarget.value !== "" && updateDepthLayerLimit(event.currentTarget.valueAsNumber)} onValueChange={updateDepthLayerLimit} /></span>{/snippet}</Field>
              <small class="depth-note">Up to {studio.project.waterDepthLayerLimit} {studio.project.waterDepthLayerLimit === 1 ? "layer" : "layers"} ({shownLength(studio.project.waterDepthLayerLimit * studio.project.materialThicknessMm)} {studio.shownLengthUnit}) below the lowest land. Land height stays unchanged.</small>
              <Switch checked={studio.project.fitLakeDepth} onCheckedChange={(fitLakeDepth) => void updateFabrication({ fitLakeDepth })} aria-label="Fit lake depth to available layers"><span class="toggle-label">Fit lake depth to available layers</span></Switch>
              <small class="depth-note">Compresses lakes into your depth allowance while preserving their floor shape and shorelines. With fitting off, deeper areas are clipped.</small>
            {:else}
              <small class="depth-note">Automatic: adds all layers needed for the requested water depth. Currently {studio.stackPlan.depthLayerCount} depth {studio.stackPlan.depthLayerCount === 1 ? "layer" : "layers"} ({shownLength(studio.stackPlan.depthLayerCount * studio.project.materialThicknessMm)} {studio.shownLengthUnit}) below the lowest land.</small>
            {/if}
            {#each studio.geometry.waterSurfaces.filter((lake) => lake.depthFitScale !== undefined) as lake (lake.id)}
              <small class="depth-note">{lake.name ?? "Lake"}: {lake.appliedDepthExaggeration!.toFixed(2)}× terrain depth applied · {Math.round(lake.depthFitScale! * 100)}% of requested depth.</small>
            {/each}
          </div>
        {/if}
        {#if studio.project.showWaterDepth && (studio.activeSource.bathymetryStatus === "available" || studio.activeSource.bathymetryStatus === "partial")}
          <small class="depth-note">Surveyed lake-floor data is used where available. Gaps use existing terrain or modeled depths.</small>
        {/if}
        {#if studio.project.showWaterDepth && studio.modeledLakes.length}
          <div class="toggle-settings">
            <div class="subgroup-heading subgroup-heading--action">
              <p>Maximum depth</p>
              {#if studio.hasDepthOverride}<button type="button" onclick={() => void updateFabrication({ waterDepthOverrides: {} })}>Reset</button>{/if}
            </div>
            <div class="field-stack">
              {#each studio.modeledLakes as lake (lake.id)}
                <Field label={lake.name} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={`${lake.name} maximum depth`} value={shownDepth(lake.maxDepthM)} min={1} max={Math.round(displayElevation(12000, studio.project.units))} onValueChange={(depth) => void setLakeDepth(lake.hylakId, depth)} disabled={charted(lake.hylakId)} /><em>{studio.shownElevationUnit}</em></span>{/snippet}</Field>
                <p class="depth-chart-row">
                  {#if charted(lake.hylakId)}
                    <span>Depth chart in use</span>
                    <button type="button" onclick={() => void studio.clearDepthChart(String(lake.hylakId))}>Stop using it</button>
                  {:else if !studio.embeddedInPlatform}
                    <!-- Charts are built in their own view; this only points there. The platform embed has no such view. -->
                    <button type="button" onclick={() => { openCustomDataSection("charts"); studio.mode = "custom"; }}>Use a depth chart…</button>
                  {/if}
                </p>
              {/each}
            </div>
            <small class="depth-note">Estimated from shoreline terrain slopes and GLOBathy/HydroLAKES depths. This is a modeled lake floor.{#if !studio.embeddedInPlatform} A depth chart of your own replaces it.{/if}</small>
          </div>
        {/if}
        <div class="depth-note">{#if !studio.embeddedInPlatform}<FeedbackButton label="Report lake data quality" type="lake" getContext={getFeedbackContext} />{/if} <LakeDepthHelp {openLakeDepthHelp} /></div>
      </div>
    </div>
  </div>

  <div class="detail-group">
    <p class="subgroup-heading">Inserts and paint</p>
    <div class="toggle-stack">
      <Switch checked={Boolean(inserts)} disabled={!studio.project.showWaterDepth && !inserts} onCheckedChange={(on) => void updateFabrication({ waterInserts: on ? { fitClearanceMm: DEFAULT_WATER_INSERT_CLEARANCE_MM, excludedLakeIds: [] } : undefined })} aria-label="Acrylic water inserts"><span class="toggle-label"><Droplets size={16} />Acrylic water inserts</span></Switch>
      <Switch checked={studio.project.paintTemplates.includes("water")} onCheckedChange={(on) => void updateFabrication({ paintTemplates: on ? ["water"] : [] })} aria-label="Water paint templates"><span class="toggle-label"><SprayCan size={16} />Water paint templates</span></Switch>
    </div>
    {#if !studio.project.showWaterDepth}<small class="depth-note insert-note">Acrylic water inserts need <strong>Water depth</strong> on: they replace each lake on the sheet that carries its waterline.</small>{/if}
    {#if inserts}
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
  </div>
  {/if}
</PanelFrame>
