<script lang="ts">
  import { Layers3 } from "@lucide/svelte";
  import { getStudio } from "$lib/studio/studio-context";

  const studio = getStudio();
  const airspaceLevel = $derived(studio.mode === "2d" && studio.selectedAirspaceLevel !== undefined ? studio.geometry.airspaceStack?.levels[studio.selectedAirspaceLevel] : undefined);
  const { updateProject } = studio;
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
  <label class="cut-material">Cut material <select aria-label="Cut material" value={airspaceLevel ? "airspace" : "terrain"} onchange={(event) => { studio.selectedAirspaceLevel = event.currentTarget.value === "airspace" ? 0 : undefined; }}><option value="terrain">Terrain sheets</option><option value="airspace">Airspace acrylic</option></select></label>
{/if}
{#if airspaceLevel}
  <div class="layer-dock">
    <div class="layer-heading"><span><Layers3 size={16} /><b>Airspace level {airspaceLevel.index + 1}</b> of {studio.geometry.airspaceStack!.levels.length}</span><strong>{airspaceLevel.altitudeFt.toLocaleString()} ft MSL</strong></div>
    <input class="layer-range" aria-label="Selected airspace level" type="range" min="0" max={studio.geometry.airspaceStack!.levels.length - 1} value={airspaceLevel.index} oninput={(event) => { studio.selectedAirspaceLevel = Number(event.currentTarget.value); }} />
    <div class="layer-scale"><span>Lowest</span><span>{airspaceLevel.pieces.length} acrylic {airspaceLevel.pieces.length === 1 ? "piece" : "pieces"}</span><span>Highest</span></div>
  </div>
{:else if studio.project.outputMode === "stack" && studio.embeddedInPlatform}
  <!-- The platform's field rows: label, a slider, and its value as a number at the row's end. -->
  {@const layerFill = studio.geometry.layers.length > 1 ? (studio.selectedLayer / (studio.geometry.layers.length - 1)) * 100 : 0}
  <section class="layer-dock prop-card" aria-label="Preview layers">
    <div class="field-row"><label class="layer-heading" for="atomm-selected-layer">Layer {studio.selectedLayer + 1} of {studio.geometry.layers.length}</label><div class="control"><input id="atomm-selected-layer" class="layer-range slider" style:--fill={`${layerFill}%`} aria-label="Selected layer" type="range" min="0" max={Math.max(0, studio.geometry.layers.length - 1)} value={studio.selectedLayer} oninput={selectLayer} /><span class="value">{studio.layerTicks[studio.selectedLayer]?.toLocaleString()} {studio.shownElevationUnit}</span></div></div>
    {#if studio.mode === "3d"}<div class="field-row"><label for="atomm-stack-separation">Explode</label><div class="control"><input id="atomm-stack-separation" class="slider" style:--fill={`${studio.explodedPreview * 100}%`} aria-label="Stack separation" type="range" min="0" max="1" step="0.05" value={studio.explodedPreview} oninput={dragSeparation} onchange={commitSeparation} /><span class="value">{Math.round(studio.explodedPreview * 100)}%</span></div></div>{/if}
  </section>
{:else if studio.project.outputMode === "stack"}<div class="layer-dock"><div class="layer-heading"><span><Layers3 size={16} /><b>Layer {studio.selectedLayer + 1}</b> of {studio.geometry.layers.length}</span><strong>{studio.layerTicks[studio.selectedLayer]?.toLocaleString()} {studio.shownElevationUnit}</strong></div><input class="layer-range" aria-label="Selected layer" type="range" min="0" max={Math.max(0, studio.geometry.layers.length - 1)} value={studio.selectedLayer} oninput={selectLayer} /><div class="layer-scale"><span>{studio.layerTicks[0]?.toLocaleString()} {studio.shownElevationUnit}</span><span>{studio.layerTicks[Math.floor(studio.layerTicks.length / 2)]?.toLocaleString()} {studio.shownElevationUnit}</span><span>{studio.layerTicks.at(-1)?.toLocaleString()} {studio.shownElevationUnit}</span></div>{#if studio.mode === "3d"}<label class="explode-control"><span>Stack</span><input aria-label="Stack separation" type="range" min="0" max="1" step="0.05" value={studio.explodedPreview} oninput={dragSeparation} onchange={commitSeparation} /><span>Exploded</span></label>{/if}</div>{/if}

<style>
  .cut-material { display: flex; align-items: center; gap: 0.75rem; padding: 0.5rem 1rem; }
  .cut-material select { flex: 1; }
</style>
