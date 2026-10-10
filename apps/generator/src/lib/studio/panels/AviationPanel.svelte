<script lang="ts">
  import { Plane } from "@lucide/svelte";
  import { AVIATION_DATA_DETAILS, aviationRequested, DEFAULT_AIRSPACE_STACK, DEFAULT_AVIATION_MM, DEFAULT_AVIATION_SYMBOL_MM, MAX_AVIATION_SYMBOL_MM, MIN_AVIATION_SYMBOL_MM, NO_AVIATION } from "@topostack/core";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import AirspaceSettings from "$lib/studio/panels/AirspaceSettings.svelte";
  import LineWidthField from "$lib/studio/panels/LineWidthField.svelte";
  import PanelFrame from "$lib/studio/panels/PanelFrame.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /** FAA aeronautical detail drawn on the map, its line style, and airspace built in acrylic above the terrain. */
  const studio = getStudio();
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
</script>

<PanelFrame id="aviation" title="Aviation (US)">
  <div class="detail-group">
    <p class="subgroup-heading">On the map</p>
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

  {#if aviationRequested(studio.project)}
    <div class="detail-group">
      <p class="subgroup-heading">Line style</p>
      <div class="field-stack">
        <LineWidthField label="Airspace and runways" fieldLabel="Aviation line width" key="aviationMm" fallbackMm={DEFAULT_AVIATION_MM} />
        <LineWidthField label="Symbol size" fieldLabel="Aviation symbol size" key="aviationSymbolMm" fallbackMm={DEFAULT_AVIATION_SYMBOL_MM} minMm={MIN_AVIATION_SYMBOL_MM} maxMm={MAX_AVIATION_SYMBOL_MM} fine={false} />
      </div>
      <small class="depth-note">Class B is drawn heavier, Class D dashed and special use airspace hatched on the inside, each in its own SVG group. Symbols follow the VFR sectional legend.</small>
    </div>
  {/if}

  {#if studio.project.outputMode === "stack"}
    <div class="detail-group">
      <p class="subgroup-heading">Airspace in acrylic</p>
      <div class="toggle-stack">
        <Switch checked={Boolean(studio.project.airspaceStack)} onCheckedChange={(on) => void studio.updateFabrication({ airspaceStack: on ? structuredClone(DEFAULT_AIRSPACE_STACK) : undefined })} aria-label="Airspace in 3D"><span class="toggle-label"><Plane size={16} />Airspace in 3D</span></Switch>
      </div>
      {#if studio.project.airspaceStack}<AirspaceSettings settings={studio.project.airspaceStack} />{:else}<small class="depth-note">Builds the airspace over the model as acrylic pieces standing on rods above the terrain.</small>{/if}
    </div>
  {/if}
</PanelFrame>
