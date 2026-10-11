<script lang="ts">
  import { Layers3, Map as MapIcon, Mountain, Search, Waves } from "@lucide/svelte";
  import { tick } from "svelte";
  import { PRESETS } from "$lib/studio/options";
  import Switch from "$lib/studio/StudioSwitch.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  const studio = getStudio();
  const { choosePlace } = studio;
  async function editMapArea(): Promise<void> {
    studio.mode = "map"; studio.previewNotice = "";
    await tick();
    document.querySelector(".atomm-workbench .gen-canvas")?.scrollIntoView({ block: "start" });
  }
</script>

<!-- Where the model is: the location search, suggested places, and in the embed the map area tools. -->
<div class="setup-location">
  <div class="subsection-label-row">
    <div class="subsection-label">Location</div>
    <span class:pending={studio.terrainDataStale} class="terrain-data-badge">{studio.terrainDataStale ? "Regeneration pending" : "Requires regeneration"}</span>
  </div>
  <button bind:this={studio.locationTrigger} class="location-card" aria-haspopup="dialog" onclick={() => studio.searchOpen = true}>
    <span class="location-icon"><MapIcon size={18} /></span>
    <span>
      <strong>{studio.embeddedInPlatform ? "Choose location" : studio.project.location.label.split(",")[0]}</strong>
      <small>{studio.embeddedInPlatform ? studio.project.location.label.split(",")[0] : studio.project.location.label.split(",").slice(1).join(",") || "Selected coordinates"}</small>
    </span>
    <Search size={17} />
  </button>
  {#if studio.embeddedInPlatform}<button type="button" class="btn btn-secondary atomm-edit-map" aria-pressed={studio.mode === "map"} onclick={editMapArea}><MapIcon size={16} aria-hidden="true" />Edit map area</button><p class="preset-label">Suggested places</p>{/if}
  <div class="preset-row" role={studio.embeddedInPlatform ? "group" : undefined} aria-label={studio.embeddedInPlatform ? "Suggested places" : undefined}>
    {#each PRESETS as preset}
      <button onclick={() => choosePlace(preset)}>{#if studio.embeddedInPlatform}{#if preset.id === "crater-lake"}<Waves size={20} aria-hidden="true" />{:else if preset.id === "grand-canyon"}<Layers3 size={20} aria-hidden="true" />{:else}<Mountain size={20} aria-hidden="true" />{/if}{/if}<span>{(preset.label.split(",")[0] ?? preset.label).replace("Mount ", "Mt. ")}</span></button>
    {/each}
  </div>
</div>
{#if studio.embeddedInPlatform}
  <Switch checked={studio.mapAspectLocked || studio.project.cropShape === "circle"} disabled={studio.project.cropShape === "circle"} onCheckedChange={(locked) => studio.mapAspectLocked = locked} aria-label="Lock aspect ratio"><span class="toggle-label">Lock aspect ratio</span></Switch>
  <p class="terrain-data-note">{studio.project.cropShape === "circle" ? "Circle proportions are always locked." : "Keep proportions when resizing the map selection. Hold Shift to lock temporarily; Esc cancels a resize."}</p>
{/if}
<!-- The embed reloads terrain as the area moves, so it has nothing to regenerate. -->
{#if !studio.embeddedInPlatform}<p class:pending={studio.terrainDataStale} class="terrain-data-note" aria-live="polite">
  {#if studio.terrainDataStale}<strong>Terrain data is from the previous map area.</strong> Generate it before export.{:else}Changing the location or map area requires terrain regeneration.{/if}
  <span>Sidebar settings update the preview automatically. Changing the cut aspect ratio loads terrain for the updated map area.</span>
</p>{/if}
