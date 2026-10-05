<script lang="ts">
  import { ChevronDown, Compass, Grid3X3, Layers3, Map as MapIcon, Minus, Mountain, Move, Plane, Square, Type, Waves } from "@lucide/svelte";
  import { Field, Section } from "@loidolt/theme-svelte";
  import { AVIATION_DATA_DETAILS, NO_AVIATION, DEFAULT_PROJECT, displayElevation, displayLength, fontEntry, isBitmapFont, MAX_WATER_DEPTH_EXAGGERATION, MIN_WATER_DEPTH_EXAGGERATION, NORTH_ARROW_MIN_SIZE_MM, PLAQUE_MAX_LINE_LENGTH, PLAQUE_MAX_LINES, PLAQUE_MAX_SIZE_MM, PLAQUE_MIN_SIZE_MM, plaqueFont, unsupportedLabelCharacters } from "@topostack/core";
  import FeedbackButton from "$lib/site/FeedbackButton.svelte";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import FontPicker from "$lib/studio/panels/FontPicker.svelte";
  import { NORTH_ARROW_OPTIONS, WATER_FILL_PATTERNS } from "$lib/studio/options";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import LakeDepthHelp from "$lib/studio/panels/LakeDepthHelp.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { openCustomDataSection } from "$lib/studio/customdata/custom-data-nav.svelte";
  import { clampPlaqueSize, DEFAULT_PLAQUE_PLACEMENT, plaqueSettings, plaqueText, plaqueWithFont } from "$lib/studio/project-edits";

  let { openLakeDepthHelp }: { openLakeDepthHelp?: (trigger: HTMLButtonElement) => void } = $props();
  const studio = getStudio();
  const plaque = $derived(studio.project.plaque);
  const titleFont = $derived(plaqueFont(studio.project));
  const unsupportedTitleCharacters = $derived.by(() => {
    // A typeface reports missing letters once it has loaded, which a new preview follows.
    void studio.geometry;
    return plaque ? unsupportedLabelCharacters(plaque.text, titleFont) : [];
  });
  /** A lake carved from the maker's own chart; its modeled maximum no longer applies. */
  const charted = (hylakId: number): boolean => studio.project.userDepthCharts?.[String(hylakId)] !== undefined;
  const aviation = $derived(studio.project.aviation ?? NO_AVIATION);
  /** Turning every group off drops the setting, so the project reads as it did before aviation existed. */
  function updateAviation(patch: Partial<typeof NO_AVIATION>): void {
    const next = { ...aviation, ...patch };
    void studio.updateMapDetails({ aviation: AVIATION_DATA_DETAILS.some((detail) => next[detail]) || next.labels ? next : undefined });
  }
  const AVIATION_TOGGLES = [
    { key: "airspace", label: "Class B, C and D airspace" },
    { key: "specialUse", label: "Special use airspace" },
    { key: "runways", label: "Runways" },
    { key: "airports", label: "Airports" },
    { key: "navaids", label: "Navaids" },
    { key: "obstacles", label: "Obstacles" },
    { key: "labels", label: "Identifiers and airspace altitudes" },
  ] as const;
  const { startPlacement, getFeedbackContext, navigateChoice, previewMarkingPath, sectionSummary, setLakeDepth, shownDepth, shownLength, shownTextSize, storedLength, toggleSection, updateDepthLayerLimit, updateFabrication, updateMapDetails } = studio;
</script>

<Section class="config-section" aria-labelledby="atomm-details-title">
  <button type="button" class="section-disclosure" id="atomm-details-title" aria-expanded={studio.openSections.details} aria-controls="section-details" onclick={() => toggleSection("details")}>
    <span class="section-number">05</span>
    <span class="section-title">Map details<small>{sectionSummary("details")}</small></span>
    <ChevronDown size={16} class={studio.openSections.details ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
  </button>
  <div id="section-details" class="section-content" hidden={!studio.openSections.details}>

  <div class="detail-column">
  <div class="detail-group">
    <p class="subgroup-heading">Terrain features</p>
    <div class="toggle-stack">
      <Switch checked={studio.project.showRoads} onCheckedChange={(showRoads) => void updateMapDetails({ showRoads })} aria-label="Roads"><span class="toggle-label"><Minus size={16} />Roads</span></Switch>
      <Switch checked={studio.project.showTrails} onCheckedChange={(showTrails) => void updateMapDetails({ showTrails })} aria-label="Trails"><span class="toggle-label"><Minus size={16} />Trails</span></Switch>
      <Switch checked={studio.project.showTransportationLabels} onCheckedChange={(showTransportationLabels) => void updateMapDetails({ showTransportationLabels })} aria-label="Transportation labels"><span class="toggle-label"><Minus size={16} />Transportation labels</span></Switch>
      <div class="toggle-control">
        <Switch checked={studio.project.showWater} onCheckedChange={(showWater) => void updateMapDetails({ showWater })} aria-label="Water outlines"><span class="toggle-label"><Waves size={16} />Water outlines</span></Switch>
        {#if studio.project.outputMode === "engraving" && studio.project.showWater}
          <div class="toggle-settings">
            <p class="subgroup-heading">Water fill</p>
            <div class="ldt-toggle-group water-pattern-options" role="radiogroup" aria-label="Water fill pattern">
              {#each WATER_FILL_PATTERNS as option}
                <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.project.waterFillPattern === option.value} data-state={studio.project.waterFillPattern === option.value ? "on" : "off"} tabindex={studio.project.waterFillPattern === option.value ? 0 : -1} onclick={() => void updateFabrication({ waterFillPattern: option.value })} onkeydown={navigateChoice}>{option.label}</button>
              {/each}
            </div>
            <small class="depth-note">Adds fabrication-ready vector marks inside water areas. None keeps outlines only.</small>
          </div>
        {/if}
      </div>
      <Switch checked={studio.project.showBoundaries} onCheckedChange={(showBoundaries) => void updateMapDetails({ showBoundaries })} aria-label="State and province boundaries"><span class="toggle-label"><MapIcon size={16} />State / province boundaries</span></Switch>
      <Switch checked={studio.project.showCoordinateGrid} onCheckedChange={(showCoordinateGrid) => void updateMapDetails({ showCoordinateGrid })} aria-label="Latitude and longitude grid"><span class="toggle-label"><Grid3X3 size={16} />Latitude / longitude grid</span></Switch>
      {#if studio.project.outputMode === "engraving"}
        <Switch checked={studio.project.showEngravingBorder} onCheckedChange={(showEngravingBorder) => void updateFabrication({ showEngravingBorder })} aria-label="Engraved border"><span class="toggle-label"><Square size={16} />Engraved border</span></Switch>
      {:else}
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
      {/if}
    </div>
  </div>

  <div class="detail-group">
    <p class="subgroup-heading">Aviation (US)</p>
    <div class="toggle-stack">
      {#each AVIATION_TOGGLES as toggle (toggle.key)}
        <Switch checked={aviation[toggle.key]} onCheckedChange={(checked) => updateAviation({ [toggle.key]: checked })} aria-label={toggle.label}><span class="toggle-label"><Plane size={16} />{toggle.label}</span></Switch>
      {/each}
    </div>
    {#if studio.activeSource.aviationStatus === "not-covered" && AVIATION_DATA_DETAILS.some((detail) => aviation[detail])}
      <small class="depth-note">FAA data covers only the United States and its territories, so this area has no aviation detail.</small>
    {:else}
      <small class="depth-note">FAA aeronautical data{studio.activeSource.aviationCycle ? `, cycle ${studio.activeSource.aviationCycle}` : ""}. Decorative only: not for navigation.</small>
    {/if}
  </div>

  {#if studio.project.outputMode === "stack"}<div class="detail-group">
    <p class="subgroup-heading">Assembly</p>
    <div class="toggle-stack">
      <Switch checked={studio.project.showAlignmentGuides} onCheckedChange={(showAlignmentGuides) => void updateMapDetails({ showAlignmentGuides })} aria-label="Assembly guides"><span class="toggle-label"><Layers3 size={16} />Assembly guides</span></Switch>
    </div>
  </div>{/if}

  </div>
  <div class="detail-column">
  <div class="detail-group">
    <p class="subgroup-heading">Annotations</p>
    <div class="toggle-stack">
      <div class="toggle-control">
        <Switch checked={studio.project.showElevationLabels} onCheckedChange={(showElevationLabels) => void updateMapDetails({ showElevationLabels })} aria-label="Elevation labels"><span class="toggle-label"><Mountain size={16} />Elevation labels</span></Switch>
        {#if studio.project.showElevationLabels}
          <div class="toggle-settings">
            <p class="subgroup-heading">Preferred position</p>
            <div class="field-stack field-stack--offsets">
              <Field label="Label X" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Label X" value={Math.round(studio.project.elevationLabelPosition.x * 100)} min={-90} max={90} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ elevationLabelPosition: { ...studio.project.elevationLabelPosition, x: event.currentTarget.valueAsNumber / 100 } })} onValueChange={(x) => x !== Math.round(studio.project.elevationLabelPosition.x * 100) && void updateFabrication({ elevationLabelPosition: { ...studio.project.elevationLabelPosition, x: x / 100 } })} /><em>%</em></span>{/snippet}</Field>
              <Field label="Label Y" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Label Y" value={Math.round(studio.project.elevationLabelPosition.y * 100)} min={-90} max={90} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ elevationLabelPosition: { ...studio.project.elevationLabelPosition, y: event.currentTarget.valueAsNumber / 100 } })} onValueChange={(y) => y !== Math.round(studio.project.elevationLabelPosition.y * 100) && void updateFabrication({ elevationLabelPosition: { ...studio.project.elevationLabelPosition, y: y / 100 } })} /><em>%</em></span>{/snippet}</Field>
            </div>
          </div>
        {/if}
      </div>

      <div class="toggle-control">
        <Switch checked={studio.project.showNorthArrow} onCheckedChange={(showNorthArrow) => void updateMapDetails({ showNorthArrow })} aria-label="North arrow"><span class="toggle-label"><Compass size={16} />North arrow</span></Switch>
        {#if studio.project.showNorthArrow}
          <div class="toggle-settings">
            <p class="subgroup-heading">Compass design</p>
            <div class="swatch-options" role="radiogroup" aria-label="North arrow design">
              {#each NORTH_ARROW_OPTIONS as option}
                <button type="button" role="radio" aria-checked={studio.project.northArrowStyle === option.value} data-state={studio.project.northArrowStyle === option.value ? "on" : "off"} tabindex={studio.project.northArrowStyle === option.value ? 0 : -1} onclick={() => void updateFabrication({ northArrowStyle: option.value })} onkeydown={navigateChoice}>
                  <svg viewBox="-52 -52 104 104" aria-hidden="true">{#each option.markings as marking}<path d={previewMarkingPath(marking)} />{/each}</svg>
                  <span>{option.label}</span>
                </button>
              {/each}
            </div>
            <div class="range-field">
              <span class="range-field__label"><b>Diameter</b></span>
              <div class="range-field__row">
                <input aria-label="North arrow size slider" type="range" min={displayLength(NORTH_ARROW_MIN_SIZE_MM, studio.project.units)} max={displayLength(studio.northArrowSizeLimitMm, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 1} value={displayLength(studio.project.northArrowSizeMm, studio.project.units)} oninput={(event) => void updateFabrication({ northArrowSizeMm: storedLength(event.currentTarget.valueAsNumber) })} />
                <span class="number-input number-input--compact"><NumberField label="North arrow size" value={shownTextSize(studio.project.northArrowSizeMm)} min={displayLength(NORTH_ARROW_MIN_SIZE_MM, studio.project.units)} max={displayLength(studio.northArrowSizeLimitMm, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ northArrowSizeMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const sizeMm = storedLength(value); if (sizeMm !== studio.project.northArrowSizeMm) void updateFabrication({ northArrowSizeMm: sizeMm }); }} /><em>{studio.shownLengthUnit}</em></span>
              </div>
              <small><span>{shownTextSize(NORTH_ARROW_MIN_SIZE_MM)} {studio.shownLengthUnit}</span><span>{shownTextSize(studio.northArrowSizeLimitMm)} {studio.shownLengthUnit}</span></small>
            </div>
            <div class="subgroup-heading subgroup-heading--action">
              <p>Placement</p>
              <button type="button" onclick={() => void updateFabrication({ northArrowPlacement: structuredClone(DEFAULT_PROJECT.northArrowPlacement) })}>Reset position</button>
            </div>
            <button type="button" class="placement-start" aria-pressed={studio.placement?.selected === "north"} onclick={() => startPlacement("north")}><Move size={14} />{studio.placement?.selected === "north" ? "Placing on preview" : "Move on preview"}</button>
          </div>
        {/if}
      </div>

      <div class="toggle-control">
        <Switch checked={studio.project.showScaleBar} onCheckedChange={(showScaleBar) => void updateMapDetails({ showScaleBar })} aria-label="Scale bar"><span class="toggle-label"><Minus size={16} />Scale bar</span></Switch>
        {#if studio.project.showScaleBar}
          <div class="toggle-settings">
            <div class="subgroup-heading subgroup-heading--action">
              <p>Placement</p>
              {#if studio.project.scaleBarPlacement}<button type="button" onclick={() => void updateFabrication({ scaleBarPlacement: undefined })}>Reset position</button>{/if}
            </div>
            <button type="button" class="placement-start" aria-pressed={studio.placement?.selected === "scale"} onclick={() => startPlacement("scale")}><Move size={14} />{studio.placement?.selected === "scale" ? "Placing on preview" : "Move on preview"}</button>
          </div>
        {/if}
      </div>

      <div class="toggle-control">
        <Switch checked={plaque?.enabled ?? false} onCheckedChange={(enabled) => void updateMapDetails({ plaque: plaqueSettings(studio.project, { enabled }) })} aria-label="Title"><span class="toggle-label"><Type size={16} />Title</span></Switch>
        {#if plaque?.enabled}
          <div class="toggle-settings plaque-settings">
            <div class="subgroup-heading subgroup-heading--action">
              <p>Text</p>
              <button type="button" onclick={() => void updateFabrication({ plaque: plaqueSettings(studio.project, { text: plaqueText(studio.project.name) }) })}>Use project name</button>
            </div>
            <!-- The built-in fonts engrave capitals, so the field previews them; typefaces keep the case as typed. -->
            <textarea class="plaque-text" style:text-transform={isBitmapFont(titleFont) ? undefined : "none"} aria-label="Title text" aria-describedby="plaque-text-hint" rows={PLAQUE_MAX_LINES} spellcheck="false" value={plaque.text} oninput={(event) => { const text = plaqueText(event.currentTarget.value); if (text !== event.currentTarget.value) event.currentTarget.value = text; void updateFabrication({ plaque: plaqueSettings(studio.project, { text }) }); }}></textarea>
            <small id="plaque-text-hint">Up to {PLAQUE_MAX_LINES} lines of {PLAQUE_MAX_LINE_LENGTH} characters, {isBitmapFont(titleFont) ? "engraved in capitals" : "engraved as typed"} in {fontEntry(titleFont).name}.</small>
            {#if unsupportedTitleCharacters.length}<small class="plaque-warning" role="status">Not in {fontEntry(titleFont).name}, shown as “?”: {unsupportedTitleCharacters.join(" ")}</small>{/if}
            <Field label="Letter height" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Title size" value={shownTextSize(plaque.sizeMm)} min={displayLength(PLAQUE_MIN_SIZE_MM, studio.project.units)} max={displayLength(PLAQUE_MAX_SIZE_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 0.5} onValueChange={(value) => { const sizeMm = clampPlaqueSize(storedLength(value)); if (sizeMm !== plaque.sizeMm) void updateFabrication({ plaque: plaqueSettings(studio.project, { sizeMm }) }); }} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
            <p class="subgroup-heading">Title font</p>
            <FontPicker label="Title font" value={plaque.font} inherited={{ label: "Same as labels", font: studio.project.textStyle.font }} onSelect={(font) => void updateFabrication({ plaque: plaqueWithFont(studio.project, font) })} />
            <div class="subgroup-heading subgroup-heading--action">
              <p>Placement</p>
              <button type="button" onclick={() => void updateFabrication({ plaque: plaqueSettings(studio.project, { placement: structuredClone(DEFAULT_PLAQUE_PLACEMENT) }) })}>Reset position</button>
            </div>
            <button type="button" class="placement-start" aria-pressed={studio.placement?.selected === "plaque"} onclick={() => startPlacement("plaque")}><Move size={14} />{studio.placement?.selected === "plaque" ? "Placing on preview" : "Move on preview"}</button>
          </div>
        {/if}
      </div>
    </div>
  </div>

  <div class="detail-group">
    <p class="subgroup-heading">Text engraving</p>
    <FontPicker label="Engraving font" value={studio.project.textStyle.font} onSelect={(font) => font && void updateFabrication({ textStyle: { ...studio.project.textStyle, font } })} />
    <div class="range-field">
      <span class="range-field__label"><b>Text size</b></span>
      <div class="range-field__row">
        <input aria-label="Text size slider" type="range" min={displayLength(2, studio.project.units)} max={displayLength(10, studio.project.units)} step={studio.project.units === "imperial" ? 0.005 : 0.1} value={displayLength(studio.project.textStyle.sizeMm, studio.project.units)} oninput={(event) => void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm: storedLength(event.currentTarget.valueAsNumber) } })} />
        <span class="number-input number-input--compact"><NumberField label="Text size" value={shownTextSize(studio.project.textStyle.sizeMm)} min={displayLength(2, studio.project.units)} max={displayLength(10, studio.project.units)} step={studio.project.units === "imperial" ? 0.005 : 0.1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm: storedLength(event.currentTarget.valueAsNumber) } })} onValueChange={(value) => { const sizeMm = storedLength(value); if (sizeMm !== studio.project.textStyle.sizeMm) void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm } }); }} /><em>{studio.shownLengthUnit}</em></span>
      </div>
      <small><span>{shownTextSize(2)} {studio.shownLengthUnit}</span><span>{shownTextSize(10)} {studio.shownLengthUnit}</span></small>
    </div>
  </div>
  </div>
  </div>
</Section>
