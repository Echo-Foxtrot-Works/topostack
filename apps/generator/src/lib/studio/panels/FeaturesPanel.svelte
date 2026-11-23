<script lang="ts">
  import { Building2, Grid3X3, Map as MapIcon, Minus, Square, TrainTrack } from "@lucide/svelte";
  import { LINE_PRESETS, ROAD_CAPS, ROAD_STYLES, TRAIL_PATTERNS } from "$lib/studio/options";
  import { LAND_PAINT_OPTIONS, LISTED_LAND_UNITS, PAINT_COLORS, landKindLabel, landUnitLabel, withPaintKind } from "$lib/studio/paint-colors";
  import { BUILDING_MIN_ZOOM, DEFAULT_BUILDING_WIDTH_MM, landStroke, type LandClass, type LandsDetailsV1 } from "@topostack/core";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import LineWidthField from "$lib/studio/panels/LineWidthField.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";

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

<PanelFrame id="features" title={t("features.title")} class="features-panel">
  <div class="detail-group">
    <p class="subgroup-heading">{t("features.lineWeight")}</p>
    <div class="line-presets" role="radiogroup" aria-label={t("features.lineworkPreset")}>
      {#each LINE_PRESETS as preset}
        <button type="button" role="radio" aria-checked={studio.activeLinePreset === preset.value} data-state={studio.activeLinePreset === preset.value ? "on" : "off"} onclick={() => void updateFabrication({ lineStyle: { ...preset.style } })}>
          <svg viewBox="0 0 52 24" aria-hidden="true">
            <path d="M2 5H50" stroke-width={preset.style.contourMm * 5} />
            <path d="M2 12H50" stroke-width={preset.style.indexContourMm * 5} />
            <path d="M2 19H50" stroke-width={preset.style.trailMm * 5} stroke-dasharray={trailPatternDash(preset.style)} />
          </svg>
          <span><b>{t(`features.linePresetLabel.${preset.value}` as MessageKey)}</b><small>{t(`features.linePresetDescription.${preset.value}` as MessageKey)}</small></span>
        </button>
      {/each}
    </div>
    <small class="depth-note">{studio.activeLinePreset ? t("features.presetNote") : t("features.customWidthsNote")}</small>
  </div>

  <div class="detail-group">
    <p class="subgroup-heading">{t("features.onTheMap")}</p>
    <div class="toggle-stack">
      <div class="toggle-control">
        <Switch checked={studio.project.showRoads} onCheckedChange={(showRoads) => void updateMapDetails({ showRoads })} aria-label={t("features.roads")}><span class="toggle-label"><Minus size={16} />{t("features.roads")}</span></Switch>
        {#if studio.project.showRoads}
          <div class="toggle-settings">
            <div class="field-stack">
              <LineWidthField label={t("features.majorRoads")} fieldLabel={t("features.majorRoadWidth")} key="majorRoadMm" />
              <LineWidthField label={t("features.localRoads")} fieldLabel={t("features.localRoadWidth")} key="localRoadMm" />
            </div>
            <p class="subgroup-heading">{t("features.roadAppearance")}</p>
            <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label={t("features.majorRoadStyle")}>
              {#each ROAD_STYLES as option}
                <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={lineStyle.roadStyle === option.value} data-state={lineStyle.roadStyle === option.value ? "on" : "off"} tabindex={lineStyle.roadStyle === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...lineStyle, roadStyle: option.value } })} onkeydown={navigateChoice}>{t(`features.roadStyle.${option.value}` as MessageKey)}</button>
              {/each}
            </div>
            {#if lineStyle.roadStyle === "outlined"}
              <div class="field-stack"><LineWidthField label={t("features.outlineSpacing")} fieldLabel={t("features.majorRoadOutlineSpacing")} key="majorRoadSpacingMm" minMm={0.2} maxMm={4} fine={false} /></div>
            {/if}
            <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label={t("features.roadEndpointShape")}>
              {#each ROAD_CAPS as option}
                <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={lineStyle.roadCap === option.value} data-state={lineStyle.roadCap === option.value ? "on" : "off"} tabindex={lineStyle.roadCap === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...lineStyle, roadCap: option.value } })} onkeydown={navigateChoice}>{t(`features.roadCap.${option.value}` as MessageKey)}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="toggle-control">
        <Switch checked={studio.project.showTrails} onCheckedChange={(showTrails) => void updateMapDetails({ showTrails })} aria-label={t("features.trails")}><span class="toggle-label"><Minus size={16} />{t("features.trails")}</span></Switch>
        {#if studio.project.showTrails}
          <div class="toggle-settings">
            <div class="field-stack"><LineWidthField label={t("features.width")} fieldLabel={t("features.trailWidth")} key="trailMm" /></div>
            <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label={t("features.trailPattern")}>
              {#each TRAIL_PATTERNS as option}
                <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={lineStyle.trailPattern === option.value} data-state={lineStyle.trailPattern === option.value ? "on" : "off"} tabindex={lineStyle.trailPattern === option.value ? 0 : -1} onclick={() => void updateFabrication({ lineStyle: { ...lineStyle, trailPattern: option.value } })} onkeydown={navigateChoice}>{t(`features.trailPatternOption.${option.value}` as MessageKey)}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
      <div class="toggle-control">
        <Switch checked={studio.project.showRail} onCheckedChange={(showRail) => void updateMapDetails({ showRail })} aria-label={t("features.rail")}><span class="toggle-label"><TrainTrack size={16} />{t("features.rail")}</span></Switch>
        {#if studio.project.showRail}
          <div class="toggle-settings"><small class="depth-note">{t("features.railHint")}</small></div>
        {/if}
      </div>
      <div class="toggle-control">
        <Switch checked={studio.project.showBuildings} onCheckedChange={(showBuildings) => void updateMapDetails({ showBuildings })} aria-label={t("features.buildings")}><span class="toggle-label"><Building2 size={16} />{t("features.buildings")}</span></Switch>
        {#if studio.project.showBuildings}
          <div class="toggle-settings">
            <small class="depth-note">{t("features.buildingsHint", { zoom: BUILDING_MIN_ZOOM })}</small>
            <div class="field-stack"><LineWidthField label={t("features.width")} fieldLabel={t("features.buildingWidth")} key="buildingMm" fallbackMm={DEFAULT_BUILDING_WIDTH_MM} /></div>
          </div>
        {/if}
      </div>
      <Switch checked={studio.project.showTransportationLabels} onCheckedChange={(showTransportationLabels) => void updateMapDetails({ showTransportationLabels })} aria-label={t("features.transportationLabels")}><span class="toggle-label"><Minus size={16} />{t("features.transportationLabels")}</span></Switch>
      <div class="toggle-control">
        <Switch checked={studio.project.showBoundaries} onCheckedChange={(showBoundaries) => void updateMapDetails({ showBoundaries })} aria-label={t("features.stateProvinceBoundariesName")}><span class="toggle-label"><MapIcon size={16} />{t("features.stateProvinceBoundaries")}</span></Switch>
        {#if studio.project.showBoundaries}<div class="toggle-settings"><div class="field-stack"><LineWidthField label={t("features.width")} fieldLabel={t("features.boundaryLineWidth")} key="boundaryMm" /></div></div>{/if}
      </div>
      <div class="toggle-control">
        <Switch checked={studio.project.showCoordinateGrid} onCheckedChange={(showCoordinateGrid) => void updateMapDetails({ showCoordinateGrid })} aria-label={t("features.coordinateGridName")}><span class="toggle-label"><Grid3X3 size={16} />{t("features.coordinateGrid")}</span></Switch>
        {#if studio.project.showCoordinateGrid}<div class="toggle-settings"><div class="field-stack"><LineWidthField label={t("features.width")} fieldLabel={t("features.coordinateGridLineWidth")} key="coordinateGridMm" /></div></div>{/if}
      </div>
      {#if studio.project.outputMode === "engraving"}
        <div class="toggle-control">
          <Switch checked={studio.project.showEngravingBorder} onCheckedChange={(showEngravingBorder) => void updateFabrication({ showEngravingBorder })} aria-label={t("features.engravedBorder")}><span class="toggle-label"><Square size={16} />{t("features.engravedBorder")}</span></Switch>
          {#if studio.project.showEngravingBorder}<div class="toggle-settings"><div class="field-stack"><LineWidthField label={t("features.width")} fieldLabel={t("features.borderWidth")} key="borderMm" /></div></div>{/if}
        </div>
      {/if}
    </div>
  </div>
  <div class="detail-group">
    <p class="subgroup-heading">{t("features.publicLandBoundaries")}</p>
    <div class="toggle-stack land-boundary-kinds">
      {#each LAND_PAINT_OPTIONS as option (option.value)}
        <Switch checked={lands.boundaries.includes(option.value)} onCheckedChange={(on) => toggleBoundary(option.value, on)} aria-label={t(`features.landBoundaryToggle.${option.value}` as MessageKey)}><span class="toggle-label"><svg class="dash-sample" viewBox="0 0 28 6" aria-hidden="true"><path d="M1 3H27" stroke-width={option.value === "national-park" ? 2.2 : 1.4} stroke-dasharray={dashSample(option.value)} /></svg>{landKindLabel(option.value)}</span></Switch>
      {/each}
    </div>
    {#if lands.boundaries.length}
      <div class="toggle-settings">
        <div class="field-stack"><LineWidthField label={t("features.width")} fieldLabel={t("features.publicLandBoundaryWidth")} key="boundaryMm" /></div>
        <div class="toggle-stack">
          <Switch checked={lands.labels} onCheckedChange={(labels) => updateLands({ labels })} aria-label={t("features.publicLandNames")}><span class="toggle-label">{t("features.names")}</span></Switch>
          {#if studio.project.outputMode === "engraving"}
            <Switch checked={lands.hatched} onCheckedChange={(hatched) => updateLands({ hatched })} aria-label={t("features.hatchInsideName")}><span class="toggle-label">{t("features.hatchInsideEdge")}</span></Switch>
          {/if}
        </div>
      </div>
    {/if}
    {#if studio.activeSource.landsStatus === "not-covered" && lands.boundaries.length}
      <small class="depth-note">{t("features.landNotCovered")}</small>
    {:else if studio.activeSource.landsSources?.includes("openstreetmap") && lands.boundaries.length}
      <small class="depth-note">{t("features.landFromOpenStreetMap")}</small>
    {:else}
      <small class="depth-note">{t("features.landBoundariesNote")}</small>
    {/if}
  </div>

  {#if usesLand && landUnits.length}
    <div class="detail-group">
      <p class="subgroup-heading">{t("features.publicLandInArea")}</p>
      <div class="toggle-stack land-units">
        {#each landUnits as area (area.unit)}
          <Switch checked={!leftOut.has(area.unit)} onCheckedChange={(kept) => toggleUnit(area.unit, kept)} aria-label={t("features.includeUnit", { name: landUnitLabel(area) })}><span class="toggle-label"><span class="paint-swatch" style:background={PAINT_COLORS[area.landClass]} aria-hidden="true"></span>{landUnitLabel(area)}</span></Switch>
        {/each}
      </div>
      <small class="depth-note">{(studio.activeSource.landAreas?.length ?? 0) > LISTED_LAND_UNITS ? t("features.landUnitsNoteListed", { count: LISTED_LAND_UNITS }) : t("features.landUnitsNote")}</small>
    </div>
  {/if}

  {#if studio.project.outputMode === "stack"}
    <div class="detail-group">
      <p class="subgroup-heading">{t("features.publicLandPaint")}</p>
      <div class="toggle-stack land-paint-kinds">
        {#each LAND_PAINT_OPTIONS as option (option.value)}
          <Switch checked={studio.project.paintTemplates.includes(option.value)} onCheckedChange={(on) => void updateFabrication({ paintTemplates: withPaintKind(studio.project.paintTemplates, option.value, on) })} aria-label={t(`features.landPaintToggle.${option.value}` as MessageKey)}><span class="toggle-label"><span class="paint-swatch" style:background={PAINT_COLORS[option.value]} aria-hidden="true"></span>{landKindLabel(option.value)}</span></Switch>
        {/each}
      </div>
      {#if studio.activeSource.landsStatus === "not-covered" && studio.project.paintTemplates.some((kind) => kind !== "water")}
        <small class="depth-note">{t("features.landNotCovered")}</small>
      {:else if studio.activeSource.landsSources?.includes("openstreetmap") && studio.project.paintTemplates.some((kind) => kind !== "water")}
        <small class="depth-note">{t("features.landFromOpenStreetMap")}</small>
      {:else}
        <small class="depth-note">{t("features.landPaintNote")}</small>
      {/if}
    </div>
  {/if}
  <small class="linework-note">{t("features.strokeWidthNote")}</small>
</PanelFrame>
