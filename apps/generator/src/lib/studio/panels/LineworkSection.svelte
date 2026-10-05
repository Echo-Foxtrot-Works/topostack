<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import { Field, Section } from "@loidolt/theme-svelte";
  import { aviationRequested, DEFAULT_AVIATION_MM, DEFAULT_AVIATION_SYMBOL_MM, displayLength, MAX_AVIATION_SYMBOL_MM, MIN_AVIATION_SYMBOL_MM } from "@topostack/core";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import { LINE_PRESETS, ROAD_CAPS, ROAD_STYLES, TRAIL_PATTERNS } from "$lib/studio/options";
  import { getStudio } from "$lib/studio/studio-context";

  const studio = getStudio();
  const { navigateChoice, sectionSummary, setLineWidth, shownLineWidth, toggleSection, trailPatternDash, updateFabrication } = studio;
</script>

<Section class="config-section linework-section" aria-labelledby="atomm-linework-title">
  <button type="button" class="section-disclosure" id="atomm-linework-title" aria-expanded={studio.openSections.linework} aria-controls="section-linework" onclick={() => toggleSection("linework")}>
    <span class="section-number">06</span>
    <span class="section-title">Linework<small>{sectionSummary("linework")}</small></span>
    <ChevronDown size={16} class={studio.openSections.linework ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
  </button>
  <div id="section-linework" class="section-content" hidden={!studio.openSections.linework}>
  <div class="line-presets" role="radiogroup" aria-label="Linework preset">
    {#each LINE_PRESETS as preset}
      <button type="button" role="radio" aria-checked={studio.activeLinePreset === preset.value} data-state={studio.activeLinePreset === preset.value ? "on" : "off"} onclick={() => void updateFabrication({ lineStyle: { ...preset.style } })}>
        <svg viewBox="0 0 52 24" aria-hidden="true">
          <path d="M2 5H50" stroke-width={preset.style.contourMm * 5} />
          <path d="M2 12H50" stroke-width={preset.style.indexContourMm * 5} />
          <path d="M2 19H50" stroke-width={preset.style.trailMm * 5} stroke-dasharray={trailPatternDash(preset.style)} />
        </svg>
        <span><b>{preset.label}</b><small>{preset.description}</small></span>
      </button>
    {/each}
  </div>
  <button type="button" class="linework-customize" aria-expanded={studio.lineworkOpen} onclick={() => studio.lineworkOpen = !studio.lineworkOpen}>
    <span>{studio.activeLinePreset ? "Customize preset" : "Custom linework"}</span>
    <ChevronDown size={14} class={studio.lineworkOpen ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
  </button>
  {#if studio.lineworkOpen}
    <div class="linework-controls">
      {#if studio.project.outputMode === "engraving"}
        <div class="linework-group linework-group--fields">
        <p class="subgroup-heading">Topography</p>
        <div class="field-stack">
          <Field label="Minor contours" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Minor contour width" value={shownLineWidth(studio.project.lineStyle.contourMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("contourMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
          <Field label="Index contours" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Index contour width" value={shownLineWidth(studio.project.lineStyle.indexContourMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("indexContourMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        </div>
        </div>
      {/if}
      <div class="linework-group linework-group--fields">
      <p class="subgroup-heading">Map features</p>
      <div class="field-stack">
        <Field label="Major roads" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Major road width" value={shownLineWidth(studio.project.lineStyle.majorRoadMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("majorRoadMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        <Field label="Local roads" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Local road width" value={shownLineWidth(studio.project.lineStyle.localRoadMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("localRoadMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        <Field label="Trails" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Trail width" value={shownLineWidth(studio.project.lineStyle.trailMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("trailMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        <Field label="Water" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Water line width" value={shownLineWidth(studio.project.lineStyle.waterMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("waterMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        <Field label="Boundaries" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Boundary line width" value={shownLineWidth(studio.project.lineStyle.boundaryMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("boundaryMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        <Field label="Lat / long grid" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Coordinate grid line width" value={shownLineWidth(studio.project.lineStyle.coordinateGridMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("coordinateGridMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
      </div>
      </div>
      {#if aviationRequested(studio.project)}
      <div class="linework-group linework-group--fields">
      <p class="subgroup-heading">Aviation</p>
      <div class="field-stack">
        <Field label="Airspace & runways" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Aviation line width" value={shownLineWidth(studio.project.lineStyle.aviationMm ?? DEFAULT_AVIATION_MM)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("aviationMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        <Field label="Symbol size" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Aviation symbol size" value={shownLineWidth(studio.project.lineStyle.aviationSymbolMm ?? DEFAULT_AVIATION_SYMBOL_MM)} min={displayLength(MIN_AVIATION_SYMBOL_MM, studio.project.units)} max={displayLength(MAX_AVIATION_SYMBOL_MM, studio.project.units)} step={studio.project.units === "imperial" ? 0.01 : 0.1} onValueChange={(value) => void setLineWidth("aviationSymbolMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
      </div>
      <small class="depth-note">Class B is drawn heavier, Class D dashed and special use airspace hatched on the inside, each in its own SVG group. Symbols follow the VFR sectional legend.</small>
      </div>
      {/if}
      <div class="linework-group">
      <p class="subgroup-heading">Road appearance</p>
      <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Major road style">
        {#each ROAD_STYLES as option}
          <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.project.lineStyle.roadStyle === option.value} data-state={studio.project.lineStyle.roadStyle === option.value ? "on" : "off"} tabindex={studio.project.lineStyle.roadStyle === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...studio.project.lineStyle, roadStyle: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
        {/each}
      </div>
      {#if studio.project.lineStyle.roadStyle === "outlined"}
        <div class="field-stack">
          <Field label="Outline spacing" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Major road outline spacing" value={shownLineWidth(studio.project.lineStyle.majorRoadSpacingMm)} min={displayLength(0.2, studio.project.units)} max={displayLength(4, studio.project.units)} step={studio.project.units === "imperial" ? 0.005 : 0.05} onValueChange={(value) => void setLineWidth("majorRoadSpacingMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        </div>
      {/if}
      <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Road endpoint shape">
        {#each ROAD_CAPS as option}
          <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.project.lineStyle.roadCap === option.value} data-state={studio.project.lineStyle.roadCap === option.value ? "on" : "off"} tabindex={studio.project.lineStyle.roadCap === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...studio.project.lineStyle, roadCap: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
        {/each}
      </div>
      </div>
      <div class="linework-group">
      <p class="subgroup-heading">Trail pattern</p>
      <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Trail pattern">
        {#each TRAIL_PATTERNS as option}
          <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={studio.project.lineStyle.trailPattern === option.value} data-state={studio.project.lineStyle.trailPattern === option.value ? "on" : "off"} tabindex={studio.project.lineStyle.trailPattern === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...studio.project.lineStyle, trailPattern: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
        {/each}
      </div>
      </div>
      <div class="linework-group linework-group--fields">
      <p class="subgroup-heading">Finishing</p>
      <div class="field-stack">
        <Field label="Labels & guides" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Annotation width" value={shownLineWidth(studio.project.lineStyle.annotationMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("annotationMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>
        {#if studio.project.outputMode === "engraving"}<Field label="Border" class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label="Border width" value={shownLineWidth(studio.project.lineStyle.borderMm)} min={displayLength(0.05, studio.project.units)} max={displayLength(1.5, studio.project.units)} step={studio.project.units === "imperial" ? 0.001 : 0.01} onValueChange={(value) => void setLineWidth("borderMm", value)} /><em>{studio.shownLengthUnit}</em></span>{/snippet}</Field>{/if}
      </div>
      </div>
      <small class="linework-note">Stroke widths are physical SVG values. Final engraved width also depends on focus, power, speed, material, and whether your laser software treats strokes as centerlines or filled shapes.</small>
    </div>
  {/if}
  </div>
</Section>
