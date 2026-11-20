<script lang="ts">
  import { ChevronDown, Layers3 } from "@lucide/svelte";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  const studio = getStudio();
  const airspaceLevel = $derived(studio.mode === "2d" && studio.selectedAirspaceLevel !== undefined ? studio.geometry.airspaceStack?.levels[studio.selectedAirspaceLevel] : undefined);
  const { updateProject } = studio;
  // On phones the dock is one row (layer, slider, height); its scale and stack spacing fold behind this toggle.
  let detailsOpen = $state(false);
  // The heading bolds its "Layer 3" part; the message places it, so translations can move it.
  const PART = "\u0000";
  const aroundPart = (message: string): [string, string] => { const [before = "", after = ""] = message.split(PART); return [before, after]; };
  const layerHeading = $derived(aroundPart(t("terrain.layerHeading", { layer: PART, count: studio.geometry.layers.length })));
  const levelHeading = $derived(aroundPart(t("terrain.airspaceLevelHeading", { level: PART, count: studio.geometry.airspaceStack?.levels.length ?? 0 })));
  const elevation = (value: number | undefined) => value === undefined ? "" : t("terrain.elevationValue", { value, unit: studio.shownElevationUnit });
  function selectLayer(event: Event & { currentTarget: HTMLInputElement }): void {
    studio.selectedLayer = Number(event.currentTarget.value);
    if (studio.mode === "3d") studio.mode = "2d";
  }
  const dragSeparation = (event: Event & { currentTarget: HTMLInputElement }) => { studio.explodedDrag = Number(event.currentTarget.value); };
  function commitSeparation(event: Event & { currentTarget: HTMLInputElement }): void {
    studio.explodedDrag = undefined;
    updateProject({ explodedPreview: Number(event.currentTarget.value) });
  }
</script>

{#if studio.mode === "2d" && studio.geometry.airspaceStack?.levels.length}
  <label class="cut-material">{t("terrain.cutMaterial")} <select aria-label={t("terrain.cutMaterial")} value={airspaceLevel ? "airspace" : "terrain"} onchange={(event) => { studio.selectedAirspaceLevel = event.currentTarget.value === "airspace" ? 0 : undefined; }}><option value="terrain">{t("terrain.terrainSheets")}</option><option value="airspace">{t("terrain.airspaceAcrylic")}</option></select></label>
{/if}
{#if airspaceLevel}
  <div class="layer-dock">
    <div class="layer-heading"><span><Layers3 size={16} />{levelHeading[0]}<b>{t("terrain.airspaceLevel", { index: airspaceLevel.index + 1 })}</b>{levelHeading[1]}</span><strong>{t("terrain.altitudeMsl", { altitude: airspaceLevel.altitudeFt })}</strong></div>
    <input class="layer-range" aria-label={t("terrain.selectedAirspaceLevel")} type="range" min="0" max={studio.geometry.airspaceStack!.levels.length - 1} value={airspaceLevel.index} oninput={(event) => { studio.selectedAirspaceLevel = Number(event.currentTarget.value); }} />
    <div class="layer-scale"><span>{t("terrain.lowest")}</span><span>{t("terrain.acrylicPieces", { count: airspaceLevel.pieces.length })}</span><span>{t("terrain.highest")}</span></div>
  </div>
{:else if studio.project.outputMode === "stack" && studio.embeddedInPlatform}
  <!-- The platform's field rows: label, a slider, and its value as a number at the row's end. -->
  {@const layerFill = studio.geometry.layers.length > 1 ? (studio.selectedLayer / (studio.geometry.layers.length - 1)) * 100 : 0}
  <section class="layer-dock prop-card" aria-label={t("terrain.previewLayers")}>
    <div class="field-row"><label class="layer-heading" for="atomm-selected-layer">{t("terrain.layerOf", { index: studio.selectedLayer + 1, count: studio.geometry.layers.length })}</label><div class="control"><input id="atomm-selected-layer" class="layer-range slider" style:--fill={`${layerFill}%`} aria-label={t("terrain.selectedLayer")} type="range" min="0" max={Math.max(0, studio.geometry.layers.length - 1)} value={studio.selectedLayer} oninput={selectLayer} /><span class="value">{elevation(studio.layerTicks[studio.selectedLayer])}</span></div></div>
    {#if studio.mode === "3d"}<div class="field-row"><label for="atomm-stack-separation">{t("terrain.explode")}</label><div class="control"><input id="atomm-stack-separation" class="slider" style:--fill={`${studio.explodedPreview * 100}%`} aria-label={t("terrain.stackSeparation")} type="range" min="0" max="1" step="0.05" value={studio.explodedPreview} oninput={dragSeparation} onchange={commitSeparation} /><span class="value">{Math.round(studio.explodedPreview * 100)}%</span></div></div>{/if}
  </section>
{:else if studio.project.outputMode === "stack"}<div class="layer-dock" data-details-open={detailsOpen || undefined}><button type="button" class="layer-dock__toggle" aria-expanded={detailsOpen} aria-controls="layer-dock-details" aria-label={studio.mode === "3d" ? t("terrain.layerScaleAndSpacing") : t("terrain.layerScale")} title={studio.mode === "3d" ? t("terrain.layerScaleAndSpacing") : t("terrain.layerScale")} onclick={() => { detailsOpen = !detailsOpen; }}><ChevronDown size={16} aria-hidden="true" /></button><div class="layer-heading"><span><Layers3 size={16} />{layerHeading[0]}<b>{t("terrain.layer", { index: studio.selectedLayer + 1 })}</b>{layerHeading[1]}</span><strong>{elevation(studio.layerTicks[studio.selectedLayer])}</strong></div><input class="layer-range" aria-label={t("terrain.selectedLayer")} type="range" min="0" max={Math.max(0, studio.geometry.layers.length - 1)} value={studio.selectedLayer} oninput={selectLayer} /><div id="layer-dock-details" class="layer-dock__details"><div class="layer-scale"><span>{elevation(studio.layerTicks[0])}</span><span>{elevation(studio.layerTicks[Math.floor(studio.layerTicks.length / 2)])}</span><span>{elevation(studio.layerTicks.at(-1))}</span></div>{#if studio.mode === "3d"}<label class="explode-control"><span>{t("terrain.stack")}</span><input aria-label={t("terrain.stackSeparation")} type="range" min="0" max="1" step="0.05" value={studio.explodedPreview} oninput={dragSeparation} onchange={commitSeparation} /><span>{t("terrain.exploded")}</span></label>{/if}</div></div>{/if}

<style>
  .cut-material { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 1rem; }
  .cut-material select { flex: 1; }
</style>
