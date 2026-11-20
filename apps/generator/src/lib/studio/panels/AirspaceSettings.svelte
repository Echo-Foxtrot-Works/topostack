<script lang="ts">
  import { airspaceStackTint, type AirspaceStackForm, type AirspaceStackSettingsV1, type AirspaceStackTint } from "@topostack/core";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { warningText } from "$lib/i18n/warnings";
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";
  const ROD_SHAPES: Array<AirspaceStackSettingsV1["rod"]["shape"]> = ["round", "square"];
  // Two options, so a segmented control (as Road appearance), not a dropdown that truncates them.
  const ROD_JOINTS: Array<AirspaceStackSettingsV1["rod"]["joint"]> = ["segments", "through"];

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

  // Labels and notes are `aviation.build.*`, `aviation.level.*` and `aviation.tint.*` (with `…Note.*`).
  const BUILDS = ["layered", "solid"] as const;
  const LEVELS: ReadonlyArray<Layered> = ["plates", "tiers"];
  const TINTS: ReadonlyArray<AirspaceStackTint> = ["clear", "chart"];
  // Blue and magenta as the 3D preview tints them.
  const BLUE = "#3f7fd4";
  const MAGENTA = "#b44a91";
  const choose = <T,>(value: T, current: T, apply: () => void) => () => { if (value !== current) apply(); };

  const stack = $derived(studio.geometry?.airspaceStack);
  // Why nothing was built, beside the switch: the preview shows only its top two warnings.
  const emptyWarning = $derived(studio.geometry?.warnings.find((warning) => warning.code === "AIRSPACE_EMPTY"));
  const empty = $derived(emptyWarning && warningText(emptyWarning));
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
  <p class="subgroup-heading">{t("aviation.buildAs")}</p>
  <div class="line-presets airspace-choices" role="radiogroup" aria-label={t("aviation.airspaceForm")}>
    {#each BUILDS as value (value)}
      {@const on = (settings.form === "volumes") === (value === "solid")}
      <button type="button" role="radio" aria-checked={on} data-state={on ? "on" : "off"} tabindex={on ? 0 : -1} onkeydown={studio.navigateChoice} onclick={choose(on, true, () => updateForm(value === "solid" ? "volumes" : layered))}>
        <svg viewBox="0 0 52 28" aria-hidden="true">{@render profile(value === "solid" ? "volumes" : layered)}</svg>
        <span><b>{t(`aviation.build.${value}` as MessageKey)}</b><small>{t(`aviation.buildNote.${value}` as MessageKey)}</small></span>
      </button>
    {/each}
  </div>
  {#if settings.form !== "volumes"}
    <p class="subgroup-heading">{t("aviation.eachLevel")}</p>
    <div class="line-presets airspace-choices" role="radiogroup" aria-label={t("aviation.airspaceLevels")}>
      {#each LEVELS as value (value)}
        {@const on = settings.form === value}
        <button type="button" role="radio" aria-checked={on} data-state={on ? "on" : "off"} tabindex={on ? 0 : -1} onkeydown={studio.navigateChoice} onclick={choose(value, settings.form, () => updateForm(value))}>
          <svg viewBox="0 0 52 28" aria-hidden="true">{@render profile(value)}</svg>
          <span><b>{t(`aviation.level.${value}` as MessageKey)}</b><small>{t(`aviation.levelNote.${value}` as MessageKey)}</small></span>
        </button>
      {/each}
    </div>
  {/if}
  <small class="depth-note">{t(`aviation.formNote.${settings.form}` as MessageKey)}</small>
  <p class="subgroup-heading">{t("aviation.acrylic")}</p>
  <div class="line-presets airspace-choices" role="radiogroup" aria-label={t("aviation.airspaceAcrylic")}>
    {#each TINTS as value (value)}
      {@const on = tint === value}
      <button type="button" role="radio" aria-checked={on} data-state={on ? "on" : "off"} tabindex={on ? 0 : -1} onkeydown={studio.navigateChoice} onclick={choose(value, tint, () => update({ tint: value }))}>
        <svg viewBox="0 0 52 28" aria-hidden="true">
          {#if value === "chart"}
            <path class="airspace-choice-piece" d="M4 20H22M4 13H22M4 6H22" stroke={BLUE} />
            <path class="airspace-choice-piece" d="M30 17H48M30 8H48" stroke={MAGENTA} />
          {:else}
            <path class="airspace-choice-glass" d="M4 20H22M4 13H22M4 6H22M30 17H48M30 8H48" />
            <path class="airspace-choice-engraving" d="M4 20H22M4 13H22M4 6H22M30 17H48M30 8H48" />
          {/if}
        </svg>
        <span><b>{t(`aviation.tint.${value}` as MessageKey)}</b><small>{t(`aviation.tintNote.${value}` as MessageKey)}</small></span>
      </button>
    {/each}
  </div>
  <p class="subgroup-heading">{t("aviation.airspace")}</p>
  <div class="toggle-stack">
    <Switch checked={settings.classes.B} disabled={lastOn("B")} onCheckedChange={(B) => update({ classes: { ...settings.classes, B } })} aria-label={t("aviation.classBAirspace")}><span class="toggle-label">{t("aviation.classB")}</span></Switch>
    <Switch checked={settings.classes.C} disabled={lastOn("C")} onCheckedChange={(C) => update({ classes: { ...settings.classes, C } })} aria-label={t("aviation.classCAirspace")}><span class="toggle-label">{t("aviation.classC")}</span></Switch>
    <Switch checked={settings.classes.specialUse} disabled={lastOn("specialUse")} onCheckedChange={(specialUse) => update({ classes: { ...settings.classes, specialUse } })} aria-label={t("aviation.specialUseAirspace")}><span class="toggle-label">{t("aviation.specialUse")}<small>{t("aviation.specialUseNote")}</small></span></Switch>
    <Switch checked={settings.classes.D} disabled={lastOn("D")} onCheckedChange={(D) => update({ classes: { ...settings.classes, D } })} aria-label={t("aviation.classDLids")}><span class="toggle-label">{t("aviation.classD")}<small>{t("aviation.classDNote")}</small></span></Switch>
  </div>
  <div class="field-stack">
    <label class="field-row airspace-number">{t("aviation.ceilingCap")}
      <span class="number-input"><NumberField label={t("aviation.ceilingCapField")} value={settings.ceilingCapFt ?? stack?.ceilingCapFt ?? 10_000} min={1_000} max={60_000} step={500} onValueChange={(ceilingCapFt) => { if (ceilingCapFt !== settings.ceilingCapFt) update({ ceilingCapFt }); }} /><em>{t("aviation.feet")}</em></span>
    </label>
    <LengthField label={t("aviation.airspaceAcrylicThickness")} fieldLabel={t("aviation.acrylicThickness")} unit={studio.shownLengthUnit} value={shownLength(thicknessMm)} min={shownLength(1)} max={shownLength(10)} step={fine} onCommit={(shown) => { const value = storedLength(shown); if (value !== thicknessMm) update({ thicknessMm: value }); }} />
    <LengthField label={t("aviation.airspaceAcrylicKerf")} fieldLabel={t("aviation.acrylicKerf")} unit={studio.shownLengthUnit} value={shownLength(kerfMm)} min={0} max={shownLength(1)} step={finer} onCommit={(shown) => { const value = storedLength(shown); if (value !== kerfMm) update({ kerfMm: value }); }} />
  </div>
  {#if settings.ceilingCapFt !== undefined}<p class="depth-chart-row"><button type="button" onclick={() => update({ ceilingCapFt: undefined })}>{t("aviation.capAtHighestCeiling")}</button></p>{/if}
  <p class="subgroup-heading">{t("aviation.rods")}</p>
  <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label={t("aviation.rodShape")}>
    {#each ROD_SHAPES as value (value)}
      {@const on = settings.rod.shape === value}
      <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={on} data-state={on ? "on" : "off"} tabindex={on ? 0 : -1} onkeydown={studio.navigateChoice} onclick={() => { if (!on) updateRod({ shape: value }); }}>{t(`aviation.rodShapeOption.${value}` as MessageKey)}</button>
    {/each}
  </div>
  <div class="ldt-toggle-group trail-pattern-options" role="radiogroup" aria-label={t("aviation.rodJoint")}>
    {#each ROD_JOINTS as value (value)}
      {@const on = settings.rod.joint === value}
      <button type="button" class="ldt-toggle-group__item" role="radio" aria-checked={on} data-state={on ? "on" : "off"} tabindex={on ? 0 : -1} onkeydown={studio.navigateChoice} onclick={() => { if (!on) updateRod({ joint: value }); }}>{t(`aviation.rodJointOption.${value}` as MessageKey)}</button>
    {/each}
  </div>
  <small class="depth-note">{t(`aviation.rodJointNote.${settings.rod.joint}` as MessageKey)}</small>
  <div class="field-stack">
    <LengthField label={t("aviation.rodSize")} fieldLabel={settings.rod.shape === "round" ? t("aviation.rodDiameter") : t("aviation.rodWidth")} unit={studio.shownLengthUnit} value={shownLength(settings.rod.sizeMm)} min={shownLength(2)} max={shownLength(12)} step={fine} onCommit={(shown) => { const sizeMm = storedLength(shown); if (sizeMm !== settings.rod.sizeMm) updateRod({ sizeMm }); }} />
    <LengthField label={t("aviation.rodFitClearance")} fieldLabel={t("aviation.socketClearance")} unit={studio.shownLengthUnit} value={shownLength(settings.rod.fitClearanceMm)} min={0} max={shownLength(0.5)} step={finer} onCommit={(shown) => { const fitClearanceMm = storedLength(shown); if (fitClearanceMm !== settings.rod.fitClearanceMm) updateRod({ fitClearanceMm }); }} />
    <LengthField label={t("aviation.rodSocketDepth")} fieldLabel={t("aviation.socketDepth")} unit={studio.shownLengthUnit} value={shownLength(settings.rod.socketDepthMm)} min={shownLength(1)} max={shownLength(30)} step={fine} onCommit={(shown) => { const socketDepthMm = storedLength(shown); if (socketDepthMm !== settings.rod.socketDepthMm) updateRod({ socketDepthMm }); }} />
  </div>
  {#if notCovered}
    <small class="depth-note">{t("aviation.noAirspaceHere")}</small>
  {:else if empty}
    <small class="depth-note">{empty}</small>
  {:else if stack}
    <small class="depth-note">{t("aviation.stackSummary", { pieces, levels: stack.levels.length, height: shownLength(stack.topMm), unit: studio.shownLengthUnit, rods, rodLength: shownLength(rodLengthMm), backing: stack.backingSheet ? "yes" : "no" })}</small>
  {/if}
  {#if merged && studio.project.verticalExaggeration < SUGGESTED_EXAGGERATION}
    <small class="depth-note">{t("aviation.levelsMerged", { value: SUGGESTED_EXAGGERATION })}</small>
    <p class="depth-chart-row"><button type="button" onclick={() => studio.updateVerticalExaggeration(SUGGESTED_EXAGGERATION)}>{t("aviation.useSuggestedExaggeration", { value: SUGGESTED_EXAGGERATION })}</button></p>
  {/if}
  <small class="depth-note">{t("aviation.assemblyNote")}</small>
</div>
