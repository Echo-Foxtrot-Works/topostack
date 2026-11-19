<script lang="ts">
  import { Sparkles, X } from "@lucide/svelte";
  import { Button } from "@loidolt/theme-svelte";
  import FeedbackButton from "$lib/site/FeedbackButton.svelte";
  import { statusLine } from "$lib/studio/status-messages";
  import { getStudio } from "$lib/studio/studio-context";

  const studio = getStudio();
  const { cancelGeneration, generate, getFeedbackContext } = studio;
  // The platform embed loads terrain on its own, so it offers a button only
  // when that failed, was cancelled, or has not caught up with the map area.
  const needsTerrain = $derived(!studio.previewBusy && (studio.generationState === "error" || studio.generationState === "idle" || studio.activeSource.sourceKind !== "real" || studio.terrainDataStale));
</script>

<div class="generate-dock">
  {#if studio.geometry.terrainSelection}
    <details class="terrain-source-summary">
      <summary>Terrain sources</summary>
      {#if !studio.embeddedInPlatform}<FeedbackButton label="Report terrain data quality" type="terrain" getContext={getFeedbackContext} />{/if}
      {#each studio.geometry.terrainSelection.sources as source}
        <p>{source.name} · {Math.round(source.fraction * 100)}%{#if source.nativeResolutionM} · {source.nativeResolutionM} m source{/if}<br />{source.verticalDatum}</p>
      {/each}
      {#if studio.geometry.terrainSelection.sources.every((source) => source.id === "mapzen")}<p>No preferred terrain was applied to this selection.</p>{/if}
      {#each studio.geometry.terrainSelection.attempts.filter((attempt) => attempt.status === "unavailable") as attempt}<p>{attempt.name} unavailable; {studio.geometry.warnings.some((warning) => warning.code === "TERRAIN_SOURCE_FALLBACK") ? "using fallback terrain" : "another terrain source covered this area"}.</p>{/each}
      {#if studio.terrainDataStale}<p>Sources shown are for the last generated terrain.</p>{/if}
    </details>
  {/if}
  <div class={`status-line status-${studio.previewBusy ? "loading" : studio.generationState}`} role="status" aria-live="polite"><span></span>{statusLine({ generationState: studio.generationState, status: studio.status, detailsUpdating: studio.detailsUpdating, terrainDataStale: studio.terrainDataStale, terrainDataAction: studio.terrainDataAction, verticalExaggerationStale: studio.verticalExaggerationStale, exportReady: studio.exportReady, exportBlockedBy: studio.exportBlockedBy, sourceKind: studio.geometry.sourceKind })}</div>
  {#if studio.embeddedInPlatform}
    {#if needsTerrain}<Button class="btn btn-secondary generate-retry" onclick={() => void generate()}>{studio.generationState === "error" ? "Try again" : "Load terrain"}</Button>{/if}
  {:else}
  <Button variant="primary" class="generate-button" onclick={() => studio.generationState === "loading" ? cancelGeneration() : void generate()}>{#if studio.generationState === "loading"}<X size={18} /> Cancel generation{:else}<Sparkles size={18} /> {studio.geometry.sourceKind === "real" ? studio.terrainDataStale ? "Regenerate terrain data" : "Regenerate terrain" : "Generate terrain"}{/if}</Button>
  {/if}
</div>
