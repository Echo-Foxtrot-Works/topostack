<script lang="ts">
  import { Grid3X3, Map as MapIcon, Minus, Square } from "@lucide/svelte";
  import { LINE_PRESETS, ROAD_CAPS, ROAD_STYLES, TRAIL_PATTERNS } from "$lib/studio/options";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import LineWidthField from "$lib/studio/panels/LineWidthField.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * What the map draws besides terrain and water, each feature with its own
   * line settings beneath its switch. The weight presets set every stroke in
   * the project at once, including water, aviation and label lines.
   */
  const studio = getStudio();
  const { navigateChoice, trailPatternDash, updateFabrication, updateMapDetails } = studio;
  const lineStyle = $derived(studio.project.lineStyle);
</script>

<PanelFrame id="features" title="Map features" class="features-panel">
  <div class="detail-group">
    <p class="subgroup-heading">Line weight</p>
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
    <small class="depth-note">{studio.activeLinePreset ? "Sets every line in the project. Fine-tune a single feature under its switch." : "Custom widths. Pick a preset to reset every line."}</small>
  </div>

  <div class="detail-group">
    <p class="subgroup-heading">On the map</p>
    <div class="toggle-stack">
      <div class="toggle-control">
        <Switch checked={studio.project.showRoads} onCheckedChange={(showRoads) => void updateMapDetails({ showRoads })} aria-label="Roads"><span class="toggle-label"><Minus size={16} />Roads</span></Switch>
        {#if studio.project.showRoads}
          <div class="toggle-settings">
            <div class="field-stack">
              <LineWidthField label="Major roads" fieldLabel="Major road width" key="majorRoadMm" />
              <LineWidthField label="Local roads" fieldLabel="Local road width" key="localRoadMm" />
            </div>
            <p class="subgroup-heading">Road appearance</p>
            <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Major road style">
              {#each ROAD_STYLES as option}
                <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={lineStyle.roadStyle === option.value} data-state={lineStyle.roadStyle === option.value ? "on" : "off"} tabindex={lineStyle.roadStyle === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...lineStyle, roadStyle: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
              {/each}
            </div>
            {#if lineStyle.roadStyle === "outlined"}
              <div class="field-stack"><LineWidthField label="Outline spacing" fieldLabel="Major road outline spacing" key="majorRoadSpacingMm" minMm={0.2} maxMm={4} fine={false} /></div>
            {/if}
            <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Road endpoint shape">
              {#each ROAD_CAPS as option}
                <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={lineStyle.roadCap === option.value} data-state={lineStyle.roadCap === option.value ? "on" : "off"} tabindex={lineStyle.roadCap === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...lineStyle, roadCap: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="toggle-control">
        <Switch checked={studio.project.showTrails} onCheckedChange={(showTrails) => void updateMapDetails({ showTrails })} aria-label="Trails"><span class="toggle-label"><Minus size={16} />Trails</span></Switch>
        {#if studio.project.showTrails}
          <div class="toggle-settings">
            <div class="field-stack"><LineWidthField label="Width" fieldLabel="Trail width" key="trailMm" /></div>
            <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label="Trail pattern">
              {#each TRAIL_PATTERNS as option}
                <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={lineStyle.trailPattern === option.value} data-state={lineStyle.trailPattern === option.value ? "on" : "off"} tabindex={lineStyle.trailPattern === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...lineStyle, trailPattern: option.value } })} onkeydown={navigateChoice}>{option.label}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <Switch checked={studio.project.showTransportationLabels} onCheckedChange={(showTransportationLabels) => void updateMapDetails({ showTransportationLabels })} aria-label="Transportation labels"><span class="toggle-label"><Minus size={16} />Transportation labels</span></Switch>
      <div class="toggle-control">
        <Switch checked={studio.project.showBoundaries} onCheckedChange={(showBoundaries) => void updateMapDetails({ showBoundaries })} aria-label="State and province boundaries"><span class="toggle-label"><MapIcon size={16} />State / province boundaries</span></Switch>
        {#if studio.project.showBoundaries}<div class="toggle-settings"><div class="field-stack"><LineWidthField label="Width" fieldLabel="Boundary line width" key="boundaryMm" /></div></div>{/if}
      </div>
      <div class="toggle-control">
        <Switch checked={studio.project.showCoordinateGrid} onCheckedChange={(showCoordinateGrid) => void updateMapDetails({ showCoordinateGrid })} aria-label="Latitude and longitude grid"><span class="toggle-label"><Grid3X3 size={16} />Latitude / longitude grid</span></Switch>
        {#if studio.project.showCoordinateGrid}<div class="toggle-settings"><div class="field-stack"><LineWidthField label="Width" fieldLabel="Coordinate grid line width" key="coordinateGridMm" /></div></div>{/if}
      </div>
      {#if studio.project.outputMode === "engraving"}
        <div class="toggle-control">
          <Switch checked={studio.project.showEngravingBorder} onCheckedChange={(showEngravingBorder) => void updateFabrication({ showEngravingBorder })} aria-label="Engraved border"><span class="toggle-label"><Square size={16} />Engraved border</span></Switch>
          {#if studio.project.showEngravingBorder}<div class="toggle-settings"><div class="field-stack"><LineWidthField label="Width" fieldLabel="Border width" key="borderMm" /></div></div>{/if}
        </div>
      {/if}
    </div>
  </div>
  <small class="linework-note">Stroke widths are physical SVG values. Final engraved width also depends on focus, power, speed, material, and whether your laser software treats strokes as centerlines or filled shapes.</small>
</PanelFrame>
