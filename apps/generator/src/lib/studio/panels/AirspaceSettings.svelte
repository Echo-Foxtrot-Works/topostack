<script lang="ts">
  import { airspaceStackTint, type AirspaceStackForm, type AirspaceStackSettingsV1, type AirspaceStackTint } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * Airspace in 3D (docs/plans/airspace-acrylic.md): how the airspace over the
   * model is built in acrylic, and the rods that hold it. Shown under the
   * switch in the Aviation panel while the project builds airspace.
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

  type Layered = Exclude<AirspaceStackForm, "volumes">;
  // Plates and tiers are one choice, layered, and a second: what each level holds.
  // Switching to solid and back returns to the layered form last used.
  let lastLayered = $state<Layered>("plates");
  $effect(() => { if (settings.form !== "volumes") lastLayered = settings.form; });
  const layered = $derived<Layered>(settings.form === "volumes" ? lastLayered : settings.form);
  const tint = $derived(airspaceStackTint(settings));
  // A project without a tint takes its form's; changing the form here keeps the acrylic shown, so it never changes by itself.
  const updateForm = (form: AirspaceStackForm) => update({ form, tint });

  const BUILDS = [
    { value: "layered", label: "Layered", note: "Acrylic at each altitude where airspace starts or ends" },
    { value: "solid", label: "Solid", note: "Every sheet from floor to ceiling" },
  ] as const;
  const LEVELS: ReadonlyArray<{ value: Layered; label: string; note: string }> = [
    { value: "plates", label: "Whole slice", note: "All the airspace at that height" },
    { value: "tiers", label: "Shelves only", note: "Just the steps of the wedding cake" },
  ];
  const TINTS: ReadonlyArray<{ value: AirspaceStackTint; label: string; note: string }> = [
    { value: "clear", label: "Clear", note: "Class shown by engraving" },
    { value: "chart", label: "Chart colors", note: "Blue and magenta sheets" },
  ];
  const FORM_NOTES: Record<AirspaceStackForm, string> = {
    plates: "Each level is cut to all the airspace at its height, shelves frosted. Sturdy, and through rods pass several levels. Open air between levels.",
    tiers: "Each level holds only the shelves that start or end there, the chart guide's wedding cake. The least acrylic; more rods. Open air between levels.",
    volumes: "Every acrylic sheet from floor to ceiling, stacked solid. Uses far more acrylic than layered airspace.",
  };
  // Blue and magenta as the 3D preview tints them.
  const BLUE = "#3f7fd4";
  const MAGENTA = "#b44a91";
  const choose = <T,>(value: T, current: T, apply: () => void) => () => { if (value !== current) apply(); };

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
  {#snippet profile(form: AirspaceStackForm)}
    <path class="airspace-choice-ground" d="M2 26H50" />
    {#if form === "volumes"}
      <path class="airspace-choice-solid" d="M20 25V18H12V11H4V4H48V11H40V18H32V25Z" />
    {:else}
      <path class="airspace-choice-outline" d="M20 25V18H12V11H4V4H48V11H40V18H32V25" />
      <path class="airspace-choice-piece" d={form === "plates" ? "M12 18H40M4 11H48M4 4H48" : "M12 18H20M32 18H40M4 11H12M40 11H48M4 4H48M20 23H32"} />
    {/if}
  {/snippet}
  <p class="subgroup-heading">Build as</p>
  <div class="line-presets airspace-choices" role="radiogroup" aria-label="Airspace form">
    {#each BUILDS as option (option.value)}
      {@const on = (settings.form === "volumes") === (option.value === "solid")}
      <button type="button" role="radio" aria-checked={on} data-state={on ? "on" : "off"} tabindex={on ? 0 : -1} onkeydown={studio.navigateChoice} onclick={choose(on, true, () => updateForm(option.value === "solid" ? "volumes" : layered))}>
        <svg viewBox="0 0 52 28" aria-hidden="true">{@render profile(option.value === "solid" ? "volumes" : layered)}</svg>
        <span><b>{option.label}</b><small>{option.note}</small></span>
      </button>
    {/each}
  </div>
  {#if settings.form !== "volumes"}
    <p class="subgroup-heading">Each level</p>
    <div class="line-presets airspace-choices" role="radiogroup" aria-label="Airspace levels">
      {#each LEVELS as option (option.value)}
        {@const on = settings.form === option.value}
        <button type="button" role="radio" aria-checked={on} data-state={on ? "on" : "off"} tabindex={on ? 0 : -1} onkeydown={studio.navigateChoice} onclick={choose(option.value, settings.form, () => updateForm(option.value))}>
          <svg viewBox="0 0 52 28" aria-hidden="true">{@render profile(option.value)}</svg>
          <span><b>{option.label}</b><small>{option.note}</small></span>
        </button>
      {/each}
    </div>
  {/if}
  <small class="depth-note">{FORM_NOTES[settings.form]}{settings.form === "volumes" ? "" : " The two differ most where special use airspace spans several levels; over a single Class B they look much alike."}</small>
  <p class="subgroup-heading">Acrylic</p>
  <div class="line-presets airspace-choices" role="radiogroup" aria-label="Airspace acrylic">
    {#each TINTS as option (option.value)}
      {@const on = tint === option.value}
      <button type="button" role="radio" aria-checked={on} data-state={on ? "on" : "off"} tabindex={on ? 0 : -1} onkeydown={studio.navigateChoice} onclick={choose(option.value, tint, () => update({ tint: option.value }))}>
        <svg viewBox="0 0 52 28" aria-hidden="true">
          {#if option.value === "chart"}
            <path class="airspace-choice-piece" d="M4 20H22M4 13H22M4 6H22" stroke={BLUE} />
            <path class="airspace-choice-piece" d="M30 17H48M30 8H48" stroke={MAGENTA} />
          {:else}
            <path class="airspace-choice-glass" d="M4 20H22M4 13H22M4 6H22M30 17H48M30 8H48" />
            <path class="airspace-choice-engraving" d="M4 20H22M4 13H22M4 6H22M30 17H48M30 8H48" />
          {/if}
        </svg>
        <span><b>{option.label}</b><small>{option.note}</small></span>
      </button>
    {/each}
  </div>
  <p class="subgroup-heading">Airspace</p>
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
  <label class="field-row airspace-select">Rods meet pieces
    <select aria-label="Rod joint" value={settings.rod.joint} onchange={(event) => updateRod({ joint: event.currentTarget.value as AirspaceStackSettingsV1["rod"]["joint"] })}>
      <option value="segments">Glued segments</option>
      <option value="through">Through holes</option>
    </select>
  </label>
  <small class="depth-note">{settings.rod.joint === "through"
    ? "One rod per column stands in the terrain and rises through holes in the pieces; you glue each piece at the height the guide gives."
    : "A short rod between each level, glued on the outline engraved on the piece below. The guide lists every length."}</small>
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
