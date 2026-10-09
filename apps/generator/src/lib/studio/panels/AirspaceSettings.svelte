<script lang="ts">
  import { AIRSPACE_STACK_FORMS, type AirspaceStackForm, type AirspaceStackSettingsV1 } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * Airspace in 3D (docs/plans/airspace-acrylic.md): how the airspace over the
   * model is built in acrylic, and the rods that hold it. Shown under the
   * switch in Fabrication settings while the project builds airspace.
   */
  let { settings }: { settings: AirspaceStackSettingsV1 } = $props();
  const studio = getStudio();
  const { shownLength, storedLength, updateFabrication } = studio;
  const update = (patch: Partial<AirspaceStackSettingsV1>) => void updateFabrication({ airspaceStack: { ...settings, ...patch } });
  const updateRod = (patch: Partial<AirspaceStackSettingsV1["rod"]>) => update({ rod: { ...settings.rod, ...patch } });
  const thicknessMm = $derived(settings.thicknessMm ?? studio.project.materialThicknessMm);
  const kerfMm = $derived(settings.kerfMm ?? studio.project.laserKerfMm);
  const fine = $derived(studio.project.units === "imperial" ? 0.01 : 0.1);
  const finer = $derived(studio.project.units === "imperial" ? 0.001 : 0.01);

  const FORMS: Record<AirspaceStackForm, { label: string; note: string }> = {
    plates: { label: "Plates", note: "A clear plate at each altitude where airspace starts or ends, cut to the airspace there, with the shelves frosted. Open air between plates." },
    tiers: { label: "Tiers", note: "Tinted pieces where each shelf starts and ends, like the chart guide's wedding cake: blue Class B, magenta Class C. Open air between tiers." },
    volumes: { label: "Solid volumes", note: "Every acrylic sheet from floor to ceiling, stacked solid. Uses far more acrylic than plates or tiers." },
  };

  const stack = $derived(studio.geometry?.airspaceStack);
  const rods = $derived(stack?.columns.reduce((total, column) => total + column.segments.length, 0) ?? 0);
  const rodLengthMm = $derived(stack?.columns.reduce((total, column) => total + column.segments.reduce((sum, segment) => sum + segment.lengthMm, 0), 0) ?? 0);
  const pieces = $derived(stack?.levels.reduce((total, level) => total + level.pieces.length, 0) ?? 0);
  const merged = $derived(studio.geometry?.warnings.some((warning) => warning.code === "AIRSPACE_LEVELS_MERGED") ?? false);
  // The last kind switched on stays on: a project builds at least one.
  const lastOn = (key: keyof AirspaceStackSettingsV1["classes"]) => settings.classes[key] && Object.values(settings.classes).filter(Boolean).length === 1;
  const notCovered = $derived(studio.activeSource.airspaceStatus === "not-covered");
  // A whole Class B spans 100–160 km; near the studio's 10× its shelves separate (docs/reports/airspace-acrylic-spike-2026-10-09.md).
  const SUGGESTED_EXAGGERATION = 10;
</script>

<div class="toggle-settings airspace-settings">
  <p class="subgroup-heading">Airspace</p>
  <label class="field-row airspace-select">Build as
    <select aria-label="Airspace form" value={settings.form} onchange={(event) => update({ form: event.currentTarget.value as AirspaceStackForm })}>
      {#each AIRSPACE_STACK_FORMS as form (form)}<option value={form}>{FORMS[form].label}</option>{/each}
    </select>
  </label>
  <small class="depth-note">{FORMS[settings.form].note}</small>
  <div class="toggle-stack">
    <Switch checked={settings.classes.B} disabled={lastOn("B")} onCheckedChange={(B) => update({ classes: { ...settings.classes, B } })} aria-label="Class B airspace"><span class="toggle-label">Class B</span></Switch>
    <Switch checked={settings.classes.C} disabled={lastOn("C")} onCheckedChange={(C) => update({ classes: { ...settings.classes, C } })} aria-label="Class C airspace"><span class="toggle-label">Class C</span></Switch>
    <Switch checked={settings.classes.specialUse} disabled={lastOn("specialUse")} onCheckedChange={(specialUse) => update({ classes: { ...settings.classes, specialUse } })} aria-label="Special use airspace"><span class="toggle-label">Special use<small>MOAs, restricted and warning areas</small></span></Switch>
    <Switch checked={settings.classes.D} disabled={lastOn("D")} onCheckedChange={(D) => update({ classes: { ...settings.classes, D } })} aria-label="Class D lids"><span class="toggle-label">Class D<small>A flat lid over each tower airport</small></span></Switch>
  </div>
  <div class="field-stack">
    <label class="field-row airspace-number">Ceiling cap
      <span class="number-input"><NumberField label="Airspace ceiling cap" value={settings.ceilingCapFt ?? stack?.ceilingCapFt ?? 10_000} min={1_000} max={60_000} step={500} onValueChange={(ceilingCapFt) => { if (ceilingCapFt !== settings.ceilingCapFt) update({ ceilingCapFt }); }} /><em>ft</em></span>
    </label>
    <LengthField label="Airspace acrylic thickness" fieldLabel="Acrylic thickness" unit={studio.shownLengthUnit} value={shownLength(thicknessMm)} min={shownLength(1)} max={shownLength(10)} step={fine} onCommit={(shown) => { const value = storedLength(shown); if (value !== thicknessMm) update({ thicknessMm: value }); }} />
    <LengthField label="Airspace acrylic kerf" fieldLabel="Acrylic kerf" unit={studio.shownLengthUnit} value={shownLength(kerfMm)} min={0} max={shownLength(1)} step={finer} onCommit={(shown) => { const value = storedLength(shown); if (value !== kerfMm) update({ kerfMm: value }); }} />
  </div>
  {#if settings.ceilingCapFt !== undefined}<p class="depth-chart-row"><button type="button" onclick={() => update({ ceilingCapFt: undefined })}>Cap at the highest Class B or C ceiling</button></p>{/if}
  <p class="subgroup-heading">Rods</p>
  <label class="field-row airspace-select">Rod shape
    <select aria-label="Rod shape" value={settings.rod.shape} onchange={(event) => updateRod({ shape: event.currentTarget.value as AirspaceStackSettingsV1["rod"]["shape"] })}>
      <option value="round">Round</option>
      <option value="square">Square</option>
    </select>
  </label>
  <div class="field-stack">
    <LengthField label="Rod size" fieldLabel={settings.rod.shape === "round" ? "Rod diameter" : "Rod width"} unit={studio.shownLengthUnit} value={shownLength(settings.rod.sizeMm)} min={shownLength(2)} max={shownLength(12)} step={fine} onCommit={(shown) => { const sizeMm = storedLength(shown); if (sizeMm !== settings.rod.sizeMm) updateRod({ sizeMm }); }} />
    <LengthField label="Rod fit clearance" fieldLabel="Socket clearance" unit={studio.shownLengthUnit} value={shownLength(settings.rod.fitClearanceMm)} min={0} max={shownLength(0.5)} step={finer} onCommit={(shown) => { const fitClearanceMm = storedLength(shown); if (fitClearanceMm !== settings.rod.fitClearanceMm) updateRod({ fitClearanceMm }); }} />
    <LengthField label="Rod socket depth" fieldLabel="Socket depth" unit={studio.shownLengthUnit} value={shownLength(settings.rod.socketDepthMm)} min={shownLength(1)} max={shownLength(30)} step={fine} onCommit={(shown) => { const socketDepthMm = storedLength(shown); if (socketDepthMm !== settings.rod.socketDepthMm) updateRod({ socketDepthMm }); }} />
  </div>
  {#if notCovered}
    <small class="depth-note">There is no airspace here: FAA data covers the US and its territories.</small>
  {:else if stack}
    <small class="depth-note">{pieces} {pieces === 1 ? "piece" : "pieces"} on {stack.levels.length} {stack.levels.length === 1 ? "level" : "levels"}, {shownLength(stack.topMm)} {studio.shownLengthUnit} tall{rods ? `, held by ${rods} ${rods === 1 ? "rod" : "rods"} (${shownLength(rodLengthMm)} ${studio.shownLengthUnit} in all)` : ""}.{stack.backingSheet ? " Some rods go through the bottom layer onto a backing sheet, which exports with the airspace." : ""}</small>
  {/if}
  {#if merged && studio.project.verticalExaggeration < SUGGESTED_EXAGGERATION}
    <small class="depth-note">Some airspace levels are too close to separate at this exaggeration. A whole Class B separates near {SUGGESTED_EXAGGERATION}×.</small>
    <p class="depth-chart-row"><button type="button" onclick={() => studio.updateVerticalExaggeration(SUGGESTED_EXAGGERATION)}>Use {SUGGESTED_EXAGGERATION}× vertical exaggeration</button></p>
  {/if}
  <small class="depth-note">Pieces sit at true height on rods you cut to the lengths in the assembly guide, exported as separate files. Not for navigation.</small>
</div>
