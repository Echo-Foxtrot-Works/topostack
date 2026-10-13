<script lang="ts">
  import { Grid3X3, Map as MapIcon, Minus, Square } from "@lucide/svelte";
  import { LINE_PRESETS, ROAD_CAPS, ROAD_STYLES, TRAIL_PATTERNS } from "$lib/studio/options";
  import { LAND_PAINT_OPTIONS, LISTED_LAND_UNITS, PAINT_COLORS, landUnitLabel, withPaintKind } from "$lib/studio/paint-colors";
  import { landStroke, type LandClass, type LandsDetailsV1 } from "@topostack/core";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import LineWidthField from "$lib/studio/panels/LineWidthField.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * What the map draws besides terrain and water, each feature with its own
   * line settings beneath its switch. The weight presets set every stroke in
   * the project at once, including water, aviation and label lines. A layered
   * model can also take a paint template per kind of public land.
   */
  const studio = getStudio();
  const { navigateChoice, trailPatternDash, updateFabrication, updateMapDetails } = studio;
  const lineStyle = $derived(studio.project.lineStyle);
  const lands = $derived<LandsDetailsV1>(studio.project.lands ?? { boundaries: [], hatched: false, labels: false });

  /** Engraved public land; dropping every class drops the setting, as a project that never used it. */
  function updateLands(patch: Partial<LandsDetailsV1>): void {
    const next = { ...lands, ...patch };
    void updateMapDetails({ lands: next.boundaries.length ? next : undefined });
  }
  function toggleBoundary(landClass: LandClass, on: boolean): void {
    const others = lands.boundaries.filter((entry) => entry !== landClass);
    updateLands({ boundaries: on ? [...others, landClass] : others });
  }
  // Units in this area, for leaving one out (a forest around the park being modelled).
  const landUnits = $derived((studio.activeSource.landAreas ?? []).slice(0, LISTED_LAND_UNITS));
  const leftOut = $derived(new Set(studio.project.landExclusions ?? []));
  const usesLand = $derived(Boolean(studio.project.lands?.boundaries.length) || (studio.project.outputMode === "stack" && studio.project.paintTemplates.some((kind) => kind !== "water")));
  function toggleUnit(unit: string, kept: boolean): void {
    const next = (studio.project.landExclusions ?? []).filter((entry) => entry !== unit);
    if (!kept) next.push(unit);
    void updateMapDetails({ landExclusions: next.length ? next : undefined });
  }
  /** A short sample of the class's dash, drawn at a readable scale. */
  const dashSample = (landClass: LandClass) => landStroke(landClass, { boundaryMm: 0.4 }).dash?.join(" ");
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
  <div class="detail-group">
    <p class="subgroup-heading">Public land boundaries</p>
    <div class="toggle-stack land-boundary-kinds">
      {#each LAND_PAINT_OPTIONS as option (option.value)}
        <Switch checked={lands.boundaries.includes(option.value)} onCheckedChange={(on) => toggleBoundary(option.value, on)} aria-label={`${option.label} boundaries`}><span class="toggle-label"><svg class="dash-sample" viewBox="0 0 28 6" aria-hidden="true"><path d="M1 3H27" stroke-width={option.value === "national-park" ? 2.2 : 1.4} stroke-dasharray={dashSample(option.value)} /></svg>{option.label}</span></Switch>
      {/each}
    </div>
    {#if lands.boundaries.length}
      <div class="toggle-settings">
        <div class="field-stack"><LineWidthField label="Width" fieldLabel="Public land boundary width" key="boundaryMm" /></div>
        <div class="toggle-stack">
          <Switch checked={lands.labels} onCheckedChange={(labels) => updateLands({ labels })} aria-label="Public land names"><span class="toggle-label">Names</span></Switch>
          {#if studio.project.outputMode === "engraving"}
            <Switch checked={lands.hatched} onCheckedChange={(hatched) => updateLands({ hatched })} aria-label="Hatch inside public land boundaries"><span class="toggle-label">Hatch the inside edge</span></Switch>
          {/if}
        </div>
      </div>
    {/if}
    {#if studio.activeSource.landsStatus === "not-covered" && lands.boundaries.length}
      <small class="depth-note">No public land of these kinds here. Outside the United States, public land comes from OpenStreetMap where it is mapped: national parks, nature reserves (as preserves) and military land, without names.</small>
    {:else if studio.activeSource.landsSource === "openstreetmap" && lands.boundaries.length}
      <small class="depth-note">Outside the United States, public land comes from OpenStreetMap where it is mapped: national parks, nature reserves (as preserves) and military land, without names.</small>
    {:else}
      <small class="depth-note">Each kind has its own dash. The width is shared with state and province boundaries. Names go inside the largest units that have room.</small>
    {/if}
  </div>

  {#if usesLand && landUnits.length}
    <div class="detail-group">
      <p class="subgroup-heading">Public land in this area</p>
      <div class="toggle-stack land-units">
        {#each landUnits as area (area.unit)}
          <Switch checked={!leftOut.has(area.unit)} onCheckedChange={(kept) => toggleUnit(area.unit, kept)} aria-label={`Include ${landUnitLabel(area)}`}><span class="toggle-label"><span class="paint-swatch" style:background={PAINT_COLORS[area.landClass]} aria-hidden="true"></span>{landUnitLabel(area)}</span></Switch>
        {/each}
      </div>
      <small class="depth-note">Turn a unit off to leave it out of the paint templates and boundaries, such as the forest around a park.{#if (studio.activeSource.landAreas?.length ?? 0) > LISTED_LAND_UNITS} The largest {LISTED_LAND_UNITS} are listed.{/if}</small>
    </div>
  {/if}

  {#if studio.project.outputMode === "stack"}
    <div class="detail-group">
      <p class="subgroup-heading">Public land paint</p>
      <div class="toggle-stack land-paint-kinds">
        {#each LAND_PAINT_OPTIONS as option (option.value)}
          <Switch checked={studio.project.paintTemplates.includes(option.value)} onCheckedChange={(on) => void updateFabrication({ paintTemplates: withPaintKind(studio.project.paintTemplates, option.value, on) })} aria-label={`${option.label} paint template`}><span class="toggle-label"><span class="paint-swatch" style:background={PAINT_COLORS[option.value]} aria-hidden="true"></span>{option.label}</span></Switch>
        {/each}
      </div>
      {#if studio.activeSource.landsStatus === "not-covered" && studio.project.paintTemplates.some((kind) => kind !== "water")}
        <small class="depth-note">No public land of these kinds here. Outside the United States, public land comes from OpenStreetMap where it is mapped: national parks, nature reserves (as preserves) and military land, without names.</small>
      {:else if studio.activeSource.landsSource === "openstreetmap" && studio.project.paintTemplates.some((kind) => kind !== "water")}
        <small class="depth-note">Outside the United States, public land comes from OpenStreetMap where it is mapped: national parks, nature reserves (as preserves) and military land, without names.</small>
      {:else}
        <small class="depth-note">Each kind turned on gets a paper template per panel, cut to the land that stays visible after assembly. Where kinds overlap, the more specific one paints: a park over the wilderness and forest around it. US public lands from the USGS PAD-US database.</small>
      {/if}
    </div>
  {/if}
  <small class="linework-note">Stroke widths are physical SVG values. Final engraved width also depends on focus, power, speed, material, and whether your laser software treats strokes as centerlines or filled shapes.</small>
</PanelFrame>
