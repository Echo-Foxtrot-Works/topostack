<script lang="ts">
  import { Compass, Minus, Mountain, Move, Type } from "@lucide/svelte";
  import { Field } from "@loidolt/theme-svelte";
  import { DEFAULT_PROJECT, displayLength, fontEntry, isBitmapFont, NORTH_ARROW_MIN_SIZE_MM, PLAQUE_MAX_LINE_LENGTH, PLAQUE_MAX_LINES, PLAQUE_MAX_SIZE_MM, PLAQUE_MIN_SIZE_MM, plaqueFont, unsupportedLabelCharacters } from "@topostack/core";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import FontPicker from "$lib/studio/panels/FontPicker.svelte";
  import LineWidthField from "$lib/studio/panels/LineWidthField.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { NORTH_ARROW_OPTIONS } from "$lib/studio/options";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { clampPlaqueSize, DEFAULT_PLAQUE_PLACEMENT, plaqueSettings, plaqueText, plaqueWithFont } from "$lib/studio/project-edits";

  /** The text the laser writes and the marks placed on the map: font, elevation labels, north arrow, scale bar and title. */
  const studio = getStudio();
  const plaque = $derived(studio.project.plaque);
  const titleFont = $derived(plaqueFont(studio.project));
  const unsupportedTitleCharacters = $derived.by(() => {
    // A typeface reports missing letters once it has loaded, which a new preview follows.
    void studio.geometry;
    return plaque ? unsupportedLabelCharacters(plaque.text, titleFont) : [];
  });
  const { startPlacement, navigateChoice, previewMarkingPath, shownTextSize, storedLength, updateFabrication, updateMapDetails } = studio;
</script>

<PanelFrame id="labels" title="Labels and marks" class="labels-panel">
  <div class="detail-group">
    <p class="subgroup-heading">Text</p>
    <FontPicker label="Engraving font" value={studio.project.textStyle.font} onSelect={(font) => font && void updateFabrication({ textStyle: { ...studio.project.textStyle, font } })} />
    <div class="range-field">
      <span class="range-field__label"><b>Text size</b></span>
      <div class="range-field__row">
        <input aria-label="Text size slider" type="range" min={displayLength(2, studio.project.units)} max={displayLength(10, studio.project.units)} step={studio.project.units === "imperial" ? 0.005 : 0.1} value={displayLength(studio.project.textStyle.sizeMm, studio.project.units)} oninput={(event) => void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm: storedLength(event.currentTarget.valueAsNumber) } })} />
        <span class="number-input number-input--compact"><NumberField label="Text size" value={shownTextSize(studio.project.textStyle.sizeMm)} min={displayLength(2, studio.project.units)} max={displayLength(10, studio.project.units)} step={studio.project.units === "imperial" ? 0.005 : 0.1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm: storedLength(event.currentTarget.valueAsNumber) } })} onValueChange={(value) => { const sizeMm = storedLength(value); if (sizeMm !== studio.project.textStyle.sizeMm) void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm } }); }} /><em>{studio.shownLengthUnit}</em></span>
      </div>
      <small><span>{shownTextSize(2)} {studio.shownLengthUnit}</span><span>{shownTextSize(10)} {studio.shownLengthUnit}</span></small>
    </div>
    <div class="field-stack"><LineWidthField label="Label and guide lines" fieldLabel="Annotation width" key="annotationMm" /></div>
  </div>

  <div class="detail-group">
    <p class="subgroup-heading">Marks</p>
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
</PanelFrame>
