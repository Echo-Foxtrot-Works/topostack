<script lang="ts">
  import { tick } from "svelte";
  import { Building2, Compass, Layers3, Map as MapIcon, Minus, PenTool, Search, Waves } from "@lucide/svelte";
  import { Button, Field } from "@loidolt/theme-svelte";
  import LengthField from "$lib/studio/StudioLengthField.svelte";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { PRESETS } from "$lib/studio/options";
  import LinePresets from "$lib/studio/panels/LinePresets.svelte";
  import MachineFields from "$lib/studio/panels/MachineFields.svelte";
  import SizeFields from "$lib/studio/panels/SizeFields.svelte";
  import UnitSwitch from "$lib/studio/panels/UnitSwitch.svelte";
  import { GUIDE_STEPS, type GuideStep } from "$lib/studio/start-guide";
  import { getStudio, type PreviewMode } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  /**
   * The setup guide: the four decisions every model starts with, one at a
   * time, in place of the settings rail. Each step uses the same controls as
   * the panel it introduces and opens the preview that shows its effect, so
   * nothing here has to be relearned once the guide closes.
   *
   * Standalone studio only, so its own copy is English like the rest of that
   * shell; control labels come from the shared catalog.
   */
  let { step, onStep, onClose }: {
    step: GuideStep;
    onStep: (step: GuideStep) => void;
    /** Finished or skipped; either way the settings rail takes over. */
    onClose: (outcome: "finished" | "skipped") => void;
  } = $props();

  const studio = getStudio();
  const { choosePlace, generate, navigateChoice, shownLength, storedLength, updateFabrication, updateMapDetails } = studio;

  const STEP_LABELS: Record<GuideStep, string> = { type: "Type", place: "Place", look: "Look", make: "Material" };
  const TITLES: Record<GuideStep, string> = { type: "What are you making?", place: "Where, and how big?", look: "Choose the look", make: "Match your material" };
  const index = $derived(GUIDE_STEPS.indexOf(step));
  const stack = $derived(studio.project.outputMode === "stack");
  /** The preview shows sample or earlier terrain until the chosen area is generated. */
  const needsTerrain = $derived(studio.activeSource.sourceKind !== "real" || studio.terrainDataStale);
  const generating = $derived(studio.generationState === "loading");
  const modelView = (): PreviewMode => studio.project.outputMode === "engraving" ? "engraving" : studio.threeUnavailable ? "2d" : "3d";

  let heading = $state<HTMLHeadingElement>();

  /** Framing an area happens on the map; every other step is judged on the model. */
  function showStepView(next: GuideStep): void {
    if (studio.mode === "custom") return;
    studio.mode = next === "place" ? "map" : modelView();
  }

  async function go(next: GuideStep): Promise<void> {
    // Leaving the place step forward is the moment the area is settled.
    if (step === "place" && GUIDE_STEPS.indexOf(next) > index && needsTerrain && !generating) void generate();
    onStep(next);
    showStepView(next);
    await tick();
    heading?.focus({ preventScroll: true });
  }

  function finish(): void {
    if (needsTerrain && !generating) void generate();
    onClose("finished");
  }

  function chooseOutput(outputMode: "stack" | "engraving"): void {
    if (studio.project.outputMode === outputMode) return;
    studio.mode = outputMode === "engraving" ? "engraving" : studio.threeUnavailable ? "2d" : "3d";
    void updateFabrication({ outputMode });
  }
</script>

<section class="start-guide" aria-labelledby="start-guide-title" data-step={step}>
  <header class="start-guide__header">
    <div>
      <p class="start-guide__eyebrow">Setup guide · Step {index + 1} of {GUIDE_STEPS.length}</p>
      <h2 id="start-guide-title" tabindex="-1" bind:this={heading}>{TITLES[step]}</h2>
    </div>
    <button type="button" class="start-guide__skip" onclick={() => onClose("skipped")}>Skip guide</button>
  </header>
  <ol class="start-guide__steps" aria-label="Guide steps">
    {#each GUIDE_STEPS as id, position (id)}
      <li><button type="button" aria-current={id === step ? "step" : undefined} data-done={position < index ? "" : undefined} onclick={() => void go(id)}><span aria-hidden="true">{position + 1}</span>{STEP_LABELS[id]}</button></li>
    {/each}
  </ol>

  <div class="start-guide__body">
    {#if step === "type"}
      <div class="start-guide__choices" role="radiogroup" aria-label={t("place.outputType")}>
        <button type="button" role="radio" aria-checked={stack} data-state={stack ? "on" : "off"} tabindex={stack ? 0 : -1} onclick={() => chooseOutput("stack")} onkeydown={navigateChoice}>
          <Layers3 size={22} strokeWidth={1.8} aria-hidden="true" />
          <span><b>{t("place.layeredRelief")}</b><small>Cut one sheet for each elevation band, then stack and glue them into a 3D model.</small></span>
        </button>
        <button type="button" role="radio" aria-checked={!stack} data-state={stack ? "off" : "on"} tabindex={stack ? -1 : 0} onclick={() => chooseOutput("engraving")} onkeydown={navigateChoice}>
          <PenTool size={22} strokeWidth={1.8} aria-hidden="true" />
          <span><b>{t("place.flatEngraving")}</b><small>Engrave contour lines and map details onto a single piece. Nothing to stack or glue.</small></span>
        </button>
      </div>
      <p class="start-guide__note">The preview shows a sample of each. You can switch later with <b>Layered</b> and <b>Flat</b> above the preview.</p>
    {:else if step === "place"}
      <div class="start-guide__group">
        <button bind:this={studio.locationTrigger} class="location-card" aria-haspopup="dialog" onclick={() => studio.searchOpen = true}>
          <span class="location-icon"><MapIcon size={18} /></span>
          <span>
            <strong>{studio.project.location.label.split(",")[0]}</strong>
            <small>{studio.project.location.label.split(",").slice(1).join(",") || t("place.selectedCoordinates")}</small>
          </span>
          <Search size={17} />
        </button>
        <div class="preset-row" role="group" aria-label={t("place.suggestedPlaces")}>
          {#each PRESETS as preset (preset.id)}
            <button type="button" onclick={() => choosePlace(preset)}>{(preset.label.split(",")[0] ?? preset.label).replace("Mount ", "Mt. ")}</button>
          {/each}
        </div>
        <p class="start-guide__note">Search for anywhere on Earth, then drag and zoom the map to frame the area. The outline on the map is what gets made.</p>
      </div>
      <div class="start-guide__group">
        <p class="subgroup-heading">{stack ? t("place.cutSize") : t("place.artworkSize")}</p>
        <UnitSwitch />
        <SizeFields />
        <p class="start-guide__note">The finished size of the piece. Start small: a first model around 150 mm (6 in) wide cuts quickly and wastes little.</p>
      </div>
    {:else if step === "look"}
      <div class="start-guide__group">
        <p class="subgroup-heading">{t("features.lineWeight")}</p>
        <LinePresets />
      </div>
      <div class="start-guide__group">
        <p class="subgroup-heading">{t("features.onTheMap")}</p>
        <div class="toggle-stack">
          <Switch checked={studio.project.showWater} onCheckedChange={(showWater) => void updateMapDetails({ showWater })} aria-label={t("water.waterOutlines")}><span class="toggle-label"><Waves size={16} />{t("water.waterOutlines")}</span></Switch>
          {#if stack}<Switch checked={studio.project.showWaterDepth} onCheckedChange={(showWaterDepth) => void updateMapDetails({ showWaterDepth })} aria-label={t("water.waterDepth")}><span class="toggle-label"><Waves size={16} />{t("water.waterDepth")}</span></Switch>{/if}
          <Switch checked={studio.project.showRoads} onCheckedChange={(showRoads) => void updateMapDetails({ showRoads })} aria-label={t("features.roads")}><span class="toggle-label"><Minus size={16} />{t("features.roads")}</span></Switch>
          <Switch checked={studio.project.showTrails} onCheckedChange={(showTrails) => void updateMapDetails({ showTrails })} aria-label={t("features.trails")}><span class="toggle-label"><Minus size={16} />{t("features.trails")}</span></Switch>
          <Switch checked={studio.project.showBuildings} onCheckedChange={(showBuildings) => void updateMapDetails({ showBuildings })} aria-label={t("features.buildings")}><span class="toggle-label"><Building2 size={16} />{t("features.buildings")}</span></Switch>
          <Switch checked={studio.project.showNorthArrow} onCheckedChange={(showNorthArrow) => void updateMapDetails({ showNorthArrow })} aria-label={t("labels.northArrow")}><span class="toggle-label"><Compass size={16} />{t("labels.northArrow")}</span></Switch>
          <Switch checked={studio.project.showScaleBar} onCheckedChange={(showScaleBar) => void updateMapDetails({ showScaleBar })} aria-label={t("labels.scaleBar")}><span class="toggle-label"><Minus size={16} />{t("labels.scaleBar")}</span></Switch>
        </div>
        <p class="start-guide__note">These are the essentials. Each has finer settings (widths, patterns, fonts, placement) in the <b>Features</b>, <b>Water</b> and <b>Labels</b> panels afterwards.</p>
      </div>
    {:else}
      {#if stack}
        <div class="start-guide__group">
          <div class="field-stack">
            <LengthField label={t("terrain.material")} fieldLabel={t("terrain.materialThickness")} unit={studio.shownLengthUnit} value={shownLength(studio.project.materialThicknessMm)} min={shownLength(0.5)} max={shownLength(25)} step={studio.project.units === "imperial" ? 0.01 : 0.1} onCommit={(shown) => { const materialThicknessMm = storedLength(shown); if (materialThicknessMm !== studio.project.materialThicknessMm) void updateFabrication({ materialThicknessMm }); }} />
          </div>
          <p class="start-guide__note">Measure your sheet rather than trusting the label: “3 mm” plywood is often 2.7 to 3.2 mm. The thickness sets how many layers the terrain becomes: <b>{studio.stackLayerCount} layers, {shownLength(studio.stackLayerCount * studio.project.materialThicknessMm)} {studio.shownLengthUnit} tall</b> right now.</p>
        </div>
      {:else}
        <div class="start-guide__group">
          <div class="field-stack">
            <Field label={t("terrain.contourDensity")} class="field-row">{#snippet children({ id })}<span class="number-input"><NumberField {id} label={t("terrain.contourDensity")} value={studio.project.engravingContourCount} min={4} max={40} step={1} onValueChange={(value) => value !== studio.project.engravingContourCount && void updateFabrication({ engravingContourCount: value })} /><em>{t("terrain.linesUnit")}</em></span>{/snippet}</Field>
          </div>
          <p class="start-guide__note">How many contour lines the terrain is drawn with. Fewer lines read better on a small piece.</p>
        </div>
      {/if}
      <div class="start-guide__group">
        <p class="subgroup-heading">{t("terrain.machine")}</p>
        <MachineFields />
        <p class="start-guide__note">{#if stack}<b>Kerf</b> is the width your laser burns away; parts are offset by it so layers fit. <b>Work area</b> is your laser bed: leave it at 0 for no limit, or set it and larger models are split into panels. {/if}<b>Minimum feature</b> removes details too small to survive cutting or engraving.</p>
      </div>
    {/if}
  </div>

  <footer class="start-guide__footer">
    {#if index > 0}<Button class="btn btn-secondary" onclick={() => void go(GUIDE_STEPS[index - 1]!)}>Back</Button>{/if}
    {#if index < GUIDE_STEPS.length - 1}
      <Button variant="primary" class="btn btn-primary" onclick={() => void go(GUIDE_STEPS[index + 1]!)}>{step === "place" && needsTerrain && !generating ? "Load terrain and continue" : "Next"}</Button>
    {:else}
      <Button variant="primary" class="btn btn-primary" onclick={finish}>{needsTerrain && !generating ? "Generate terrain and finish" : "Finish"}</Button>
    {/if}
  </footer>
</section>

<style>
  .start-guide { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .start-guide__header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 20px 0; }
  .start-guide__eyebrow { margin: 0 0 4px; color: var(--loidolt-text-muted); font: var(--panel-font-caption) var(--loidolt-font-utility); text-transform: uppercase; letter-spacing: var(--loidolt-font-tracking-utility); }
  h2 { margin: 0; font-size: var(--panel-font-title); line-height: 1.2; }
  h2:focus { outline: none; }
  .start-guide__skip { flex: none; min-height: 32px; padding: 0 2px; border: 0; background: transparent; color: var(--loidolt-text-muted); font-size: 12px; text-decoration: underline; cursor: pointer; }
  .start-guide__steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; margin: 14px 20px 0; padding: 0; list-style: none; }
  .start-guide__steps button { width: 100%; min-height: 32px; display: flex; align-items: center; gap: 6px; padding: 6px 4px 0; border: 0; border-top: 2px solid var(--loidolt-border); background: transparent; color: var(--loidolt-text-muted); font: var(--panel-font-caption) var(--loidolt-font-utility); text-align: left; cursor: pointer; }
  .start-guide__steps button[data-done] { border-top-color: color-mix(in srgb, var(--loidolt-accent) 45%, var(--loidolt-border)); }
  .start-guide__steps button[aria-current] { border-top-color: var(--loidolt-accent); color: var(--loidolt-text); }
  .start-guide__body { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px 20px; scrollbar-color: var(--loidolt-border) transparent; }
  .start-guide__group + .start-guide__group { margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--loidolt-border-soft, var(--loidolt-border)); }
  .start-guide__note { margin: 10px 0 0; color: var(--loidolt-text-muted); font-size: 12px; line-height: 1.5; }
  .start-guide__note b { color: var(--loidolt-text); font-weight: 600; }
  .start-guide__choices { display: grid; gap: 8px; }
  .start-guide__choices button { display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 10px; align-items: start; padding: 12px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); background: var(--loidolt-surface-input); color: var(--loidolt-text-muted); text-align: left; cursor: pointer; }
  .start-guide__choices button[data-state="on"] { border-color: var(--loidolt-accent); background: color-mix(in srgb, var(--loidolt-accent) 9%, var(--loidolt-surface-input)); color: var(--loidolt-text); }
  .start-guide__choices span { display: flex; flex-direction: column; gap: 3px; }
  .start-guide__choices b { color: var(--loidolt-text); font-size: 14px; font-weight: 600; }
  .start-guide__choices small { font-size: 12px; line-height: 1.45; }
  .start-guide__footer { flex: none; display: flex; justify-content: flex-end; gap: 8px; padding: 12px 20px; border-top: var(--loidolt-border-width) solid var(--loidolt-border); }
  .start-guide__footer :global(.btn-primary) { flex: 1; }
  .start-guide__skip:focus-visible, .start-guide__steps button:focus-visible, .start-guide__choices button:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 2px; }
</style>
