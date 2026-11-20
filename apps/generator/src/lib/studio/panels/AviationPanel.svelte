<script lang="ts">
  import { Plane } from "@lucide/svelte";
  import { AIRSPACE_STACK_LIMITS, AVIATION_DATA_DETAILS, aviationRequested, DEFAULT_AIRSPACE_STACK, DEFAULT_AVIATION_MM, DEFAULT_AVIATION_SYMBOL_MM, MAX_AVIATION_SYMBOL_MM, MIN_AVIATION_SYMBOL_MM, NO_AVIATION } from "@topostack/core";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import AirspaceSettings from "$lib/studio/panels/AirspaceSettings.svelte";
  import LineWidthField from "$lib/studio/panels/LineWidthField.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";

  /** FAA aeronautical detail drawn on the map, its line style, and airspace built in acrylic above the terrain. */
  const studio = getStudio();
  const aviation = $derived(studio.project.aviation ?? NO_AVIATION);
  /** Turning every group off drops the setting, so the project reads as it did before aviation existed. */
  function updateAviation(patch: Partial<typeof NO_AVIATION>): void {
    const next = { ...aviation, ...patch };
    void studio.updateMapDetails({ aviation: AVIATION_DATA_DETAILS.some((detail) => next[detail]) || next.labels ? next : undefined });
  }
  function toggleAirspace(on: boolean): void {
    const settings = on ? structuredClone(DEFAULT_AIRSPACE_STACK) : undefined;
    const { min, max } = AIRSPACE_STACK_LIMITS.thicknessMm;
    // Wood can be thinner or thicker than acrylic stock; start those models at 3 mm.
    if (settings && (studio.project.materialThicknessMm < min || studio.project.materialThicknessMm > max)) settings.thicknessMm = 3;
    void studio.updateFabrication({ airspaceStack: settings });
  }
  const AVIATION_TOGGLES = ["airspace", "specialUse", "runways", "airports", "navaids", "obstacles", "labels"] as const;
</script>

<PanelFrame id="aviation" title={t("aviation.title")}>
  <div class="detail-group">
    <p class="subgroup-heading">{t("aviation.onTheMap")}</p>
    <div class="toggle-stack">
      {#each AVIATION_TOGGLES as key (key)}
        {@const label = t(`aviation.toggle.${key}` as MessageKey)}
        <Switch checked={aviation[key]} onCheckedChange={(checked) => updateAviation({ [key]: checked })} aria-label={label}><span class="toggle-label"><Plane size={16} />{label}</span></Switch>
      {/each}
    </div>
    {#if studio.activeSource.aviationStatus === "not-covered" && AVIATION_DATA_DETAILS.some((detail) => aviation[detail])}
      <small class="depth-note">{t("aviation.notCoveredNote")}</small>
    {:else}
      <small class="depth-note">{studio.activeSource.aviationCycle ? t("aviation.dataNoteWithCycle", { cycle: studio.activeSource.aviationCycle }) : t("aviation.dataNote")}</small>
    {/if}
  </div>

  {#if aviationRequested(studio.project)}
    <div class="detail-group">
      <p class="subgroup-heading">{t("aviation.lineStyle")}</p>
      <div class="field-stack">
        <LineWidthField label={t("aviation.airspaceAndRunways")} fieldLabel={t("aviation.lineWidth")} key="aviationMm" fallbackMm={DEFAULT_AVIATION_MM} />
        <LineWidthField label={t("aviation.symbolSize")} fieldLabel={t("aviation.symbolSizeField")} key="aviationSymbolMm" fallbackMm={DEFAULT_AVIATION_SYMBOL_MM} minMm={MIN_AVIATION_SYMBOL_MM} maxMm={MAX_AVIATION_SYMBOL_MM} fine={false} />
      </div>
      <small class="depth-note">{t("aviation.lineStyleNote")}</small>
    </div>
  {/if}

  {#if studio.project.outputMode === "stack"}
    <div class="detail-group">
      <p class="subgroup-heading">{t("aviation.airspaceInAcrylic")}</p>
      <div class="toggle-stack">
        <Switch checked={Boolean(studio.project.airspaceStack)} onCheckedChange={toggleAirspace} aria-label={t("aviation.airspaceIn3d")}><span class="toggle-label"><Plane size={16} />{t("aviation.airspaceIn3d")}</span></Switch>
      </div>
      {#if studio.project.airspaceStack}<AirspaceSettings settings={studio.project.airspaceStack} />{:else}<small class="depth-note">{t("aviation.airspaceIn3dNote")}</small>{/if}
    </div>
  {/if}
</PanelFrame>
