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
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";
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

<PanelFrame id="labels" title={t("labels.title")} class="labels-panel">
  <div class="detail-group">
    <p class="subgroup-heading">{t("labels.text")}</p>
    <FontPicker label={t("labels.engravingFont")} value={studio.project.textStyle.font} onSelect={(font) => font && void updateFabrication({ textStyle: { ...studio.project.textStyle, font } })} />
    <div class="range-field">
      <span class="range-field__label"><b>{t("labels.textSize")}</b></span>
      <div class="range-field__row">
        <input aria-label={t("labels.textSizeSlider")} type="range" min={displayLength(2, studio.project.units)} max={displayLength(10, studio.project.units)} step={studio.project.units === "imperial" ? 0.005 : 0.1} value={displayLength(studio.project.textStyle.sizeMm, studio.project.units)} oninput={(event) => void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm: storedLength(event.currentTarget.valueAsNumber) } })} />
        <span class="number-input number-input--compact"><NumberField label={t("labels.textSize")} value={shownTextSize(studio.project.textStyle.sizeMm)} min={displayLength(2, studio.project.units)} max={displayLength(10, studio.project.units)} step={studio.project.units === "imperial" ? 0.005 : 0.1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm: storedLength(event.currentTarget.valueAsNumber) } })} onValueChange={(value) => { const sizeMm = storedLength(value); if (sizeMm !== studio.project.textStyle.sizeMm) void updateFabrication({ textStyle: { ...studio.project.textStyle, sizeMm } }); }} /><em>{studio.shownLengthUnit}</em></span>
      </div>
      <small><span>{shownTextSize(2)} {studio.shownLengthUnit}</span><span>{shownTextSize(10)} {studio.shownLengthUnit}</span></small>
    </div>
    <div class="field-stack"><LineWidthField label={t("labels.labelAndGuideLines")} fieldLabel={t("labels.annotationWidth")} key="annotationMm" /></div>
  </div>

  <div class="detail-group">
    <p class="subgroup-heading">{t("labels.marks")}</p>
    <div class="toggle-stack">
      <div class="toggle-control">
        <Switch checked={studio.project.showElevationLabels} onCheckedChange={(showElevationLabels) => void updateMapDetails({ showElevationLabels })} aria-label={t("labels.elevationLabels")}><span class="toggle-label"><Mountain size={16} />{t("labels.elevationLabels")}</span></Switch>
        {#if studio.project.showElevationLabels}
          <div class="toggle-settings">
            <p class="subgroup-heading">{t("labels.preferredPosition")}</p>
            <div class="field-stack field-stack--offsets">
              <Field label={t("labels.labelX")} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("labels.labelX")} value={Math.round(studio.project.elevationLabelPosition.x * 100)} min={-90} max={90} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ elevationLabelPosition: { ...studio.project.elevationLabelPosition, x: event.currentTarget.valueAsNumber / 100 } })} onValueChange={(x) => x !== Math.round(studio.project.elevationLabelPosition.x * 100) && void updateFabrication({ elevationLabelPosition: { ...studio.project.elevationLabelPosition, x: x / 100 } })} /><em>%</em></span>{/snippet}</Field>
              <Field label={t("labels.labelY")} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("labels.labelY")} value={Math.round(studio.project.elevationLabelPosition.y * 100)} min={-90} max={90} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ elevationLabelPosition: { ...studio.project.elevationLabelPosition, y: event.currentTarget.valueAsNumber / 100 } })} onValueChange={(y) => y !== Math.round(studio.project.elevationLabelPosition.y * 100) && void updateFabrication({ elevationLabelPosition: { ...studio.project.elevationLabelPosition, y: y / 100 } })} /><em>%</em></span>{/snippet}</Field>
            </div>
          </div>
        {/if}
      </div>

      <div class="toggle-control">
        <Switch checked={studio.project.showNorthArrow} onCheckedChange={(showNorthArrow) => void updateMapDetails({ showNorthArrow })} aria-label={t("labels.northArrow")}><span class="toggle-label"><Compass size={16} />{t("labels.northArrow")}</span></Switch>
        {#if studio.project.showNorthArrow}
          <div class="toggle-settings">
            <p class="subgroup-heading">{t("labels.compassDesign")}</p>
            <div class="swatch-options" role="radiogroup" aria-label={t("labels.northArrowDesign")}>
              {#each NORTH_ARROW_OPTIONS as option}
                <button type="button" role="radio" aria-checked={studio.project.northArrowStyle === option.value} data-state={studio.project.northArrowStyle === option.value ? "on" : "off"} tabindex={studio.project.northArrowStyle === option.value ? 0 : -1} onclick={() => void updateFabrication({ northArrowStyle: option.value })} onkeydown={navigateChoice}>
                  <svg viewBox="-52 -52 104 104" aria-hidden="true">{#each option.markings as marking}<path d={previewMarkingPath(marking)} />{/each}</svg>
                  <span>{t(`labels.northArrowStyle.${option.value}` as MessageKey)}</span>
                </button>
              {/each}
            </div>
            <div class="range-field">
              <span class="range-field__label"><b>{t("labels.diameter")}</b></span>
              <div class="range-field__row">
                <input aria-label={t("labels.northArrowSizeSlider")} type="range" min={displayLength(NORTH_ARROW_MIN_SIZE_MM, studio.project.units)} max={displayLength(studio.northArrowSizeLimitMm, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 1} value={displayLength(studio.project.northArrowSizeMm, studio.project.units)} oninput={(event) => void updateFabrication({ northArrowSizeMm: storedLength(event.currentTarget.valueAsNumber) })} />
                <span class="number-input number-input--compact"><NumberField label={t("labels.northArrowSize")} value={shownTextSize(studio.project.northArrowSizeMm)} min={displayLength(NORTH_ARROW_MIN_SIZE_MM, studio.project.units)} max={displayLength(studio.northArrowSizeLimitMm, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 1} oninput={(event) => event.currentTarget.value !== "" && void updateFabrication({ northArrowSizeMm: storedLength(event.currentTarget.valueAsNumber) })} onValueChange={(value) => { const sizeMm = storedLength(value); if (sizeMm !== studio.project.northArrowSizeMm) void updateFabrication({ northArrowSizeMm: sizeMm }); }} /><em>{studio.shownLengthUnit}</em></span>
              </div>
              <small><span>{shownTextSize(NORTH_ARROW_MIN_SIZE_MM)} {studio.shownLengthUnit}</span><span>{shownTextSize(studio.northArrowSizeLimitMm)} {studio.shownLengthUnit}</span></small>
            </div>
            <div class="subgroup-heading subgroup-heading--action">
              <p>{t("labels.placement")}</p>
              <button type="button" onclick={() => void updateFabrication({ northArrowPlacement: structuredClone(DEFAULT_PROJECT.northArrowPlacement) })}>{t("labels.resetPosition")}</button>
            </div>
            <button type="button" class="placement-start" aria-pressed={studio.placement?.selected === "north"} onclick={() => startPlacement("north")}><Move size={14} />{studio.placement?.selected === "north" ? t("labels.placingOnPreview") : t("labels.moveOnPreview")}</button>
          </div>
        {/if}
      </div>

      <div class="toggle-control">
        <Switch checked={studio.project.showScaleBar} onCheckedChange={(showScaleBar) => void updateMapDetails({ showScaleBar })} aria-label={t("labels.scaleBar")}><span class="toggle-label"><Minus size={16} />{t("labels.scaleBar")}</span></Switch>
        {#if studio.project.showScaleBar}
          <div class="toggle-settings">
            <div class="subgroup-heading subgroup-heading--action">
              <p>{t("labels.placement")}</p>
              {#if studio.project.scaleBarPlacement}<button type="button" onclick={() => void updateFabrication({ scaleBarPlacement: undefined })}>{t("labels.resetPosition")}</button>{/if}
            </div>
            <button type="button" class="placement-start" aria-pressed={studio.placement?.selected === "scale"} onclick={() => startPlacement("scale")}><Move size={14} />{studio.placement?.selected === "scale" ? t("labels.placingOnPreview") : t("labels.moveOnPreview")}</button>
          </div>
        {/if}
      </div>

      <div class="toggle-control">
        <Switch checked={plaque?.enabled ?? false} onCheckedChange={(enabled) => void updateMapDetails({ plaque: plaqueSettings(studio.project, { enabled }) })} aria-label={t("labels.titleToggle")}><span class="toggle-label"><Type size={16} />{t("labels.titleToggle")}</span></Switch>
        {#if plaque?.enabled}
          <div class="toggle-settings plaque-settings">
            <div class="subgroup-heading subgroup-heading--action">
              <p>{t("labels.text")}</p>
              <button type="button" onclick={() => void updateFabrication({ plaque: plaqueSettings(studio.project, { text: plaqueText(studio.project.name) }) })}>{t("labels.useProjectName")}</button>
            </div>
            <!-- The built-in fonts engrave capitals, so the field previews them; typefaces keep the case as typed. -->
            <textarea class="plaque-text" style:text-transform={isBitmapFont(titleFont) ? undefined : "none"} aria-label={t("labels.titleText")} aria-describedby="plaque-text-hint" rows={PLAQUE_MAX_LINES} spellcheck="false" value={plaque.text} oninput={(event) => { const text = plaqueText(event.currentTarget.value); if (text !== event.currentTarget.value) event.currentTarget.value = text; void updateFabrication({ plaque: plaqueSettings(studio.project, { text }) }); }}></textarea>
            <small id="plaque-text-hint">{t("labels.titleTextHint", { lines: PLAQUE_MAX_LINES, length: PLAQUE_MAX_LINE_LENGTH, letterCase: isBitmapFont(titleFont) ? "capitals" : "typed", font: fontEntry(titleFont).name })}</small>
            {#if unsupportedTitleCharacters.length}<small class="plaque-warning" role="status">{t("labels.unsupportedCharacters", { font: fontEntry(titleFont).name, characters: unsupportedTitleCharacters.join(" ") })}</small>{/if}
            <Field label={t("labels.letterHeight")} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("labels.titleSize")} value={shownTextSize(plaque.sizeMm)} min={displayLength(PLAQUE_MIN_SIZE_MM, studio.project.units)} max={displayLength(PLAQUE_MAX_SIZE_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 0.5} onValueChange={(value) => { const sizeMm = clampPlaqueSize(storedLength(value)); if (sizeMm !== plaque.sizeMm) void updateFabrication({ plaque: plaqueSettings(studio.project, { sizeMm }) }); }} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
            <p class="subgroup-heading">{t("labels.titleFont")}</p>
            <FontPicker label={t("labels.titleFont")} value={plaque.font} inherited={{ label: t("labels.sameAsLabels"), font: studio.project.textStyle.font }} onSelect={(font) => void updateFabrication({ plaque: plaqueWithFont(studio.project, font) })} />
            <div class="subgroup-heading subgroup-heading--action">
              <p>{t("labels.placement")}</p>
              <button type="button" onclick={() => void updateFabrication({ plaque: plaqueSettings(studio.project, { placement: structuredClone(DEFAULT_PLAQUE_PLACEMENT) }) })}>{t("labels.resetPosition")}</button>
            </div>
            <button type="button" class="placement-start" aria-pressed={studio.placement?.selected === "plaque"} onclick={() => startPlacement("plaque")}><Move size={14} />{studio.placement?.selected === "plaque" ? t("labels.placingOnPreview") : t("labels.moveOnPreview")}</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
</PanelFrame>
