<script lang="ts">
  import { Sparkles, X } from "@lucide/svelte";
  import { Button } from "@loidolt/theme-svelte";
  import FeedbackButton from "$lib/site/FeedbackButton.svelte";
  import { statusLine } from "$lib/studio/status-messages";
  import { getStudio } from "$lib/studio/studio-context";
  import { t } from "$lib/i18n/i18n.svelte";

  const studio = getStudio();
  const { cancelGeneration, generate, getFeedbackContext } = studio;
  // The platform embed loads terrain on its own, so it offers a button only
  // when that failed, was cancelled, or has not caught up with the map area.
  const needsTerrain = $derived(!studio.previewBusy && (studio.generationState === "error" || studio.generationState === "idle" || studio.activeSource.sourceKind !== "real" || studio.terrainDataStale));
</script>

<div class="generate-dock">
  {#if studio.geometry.terrainSelection}
    <details class="terrain-source-summary">
      <summary>{t("place.terrainSources")}</summary>
      {#if !studio.embeddedInPlatform}<FeedbackButton label={t("place.reportTerrainQuality")} type="terrain" getContext={getFeedbackContext} />{/if}
      {#each studio.geometry.terrainSelection.sources as source}
        <p>{source.nativeResolutionM ? t("place.sourceShareResolution", { name: source.name, percent: Math.round(source.fraction * 100), resolution: source.nativeResolutionM }) : t("place.sourceShare", { name: source.name, percent: Math.round(source.fraction * 100) })}<br />{source.verticalDatum}</p>
      {/each}
      {#if studio.geometry.terrainSelection.sources.every((source) => source.id === "mapzen")}<p>{t("place.noPreferredTerrain")}</p>{/if}
      {#each studio.geometry.terrainSelection.attempts.filter((attempt) => attempt.status === "unavailable") as attempt}<p>{studio.geometry.warnings.some((warning) => warning.code === "TERRAIN_SOURCE_FALLBACK") ? t("place.sourceUnavailableFallback", { name: attempt.name }) : t("place.sourceUnavailableCovered", { name: attempt.name })}</p>{/each}
      {#if studio.terrainDataStale}<p>{t("place.sourcesFromLastTerrain")}</p>{/if}
    </details>
  {/if}
  <div class={`status-line status-${studio.previewBusy ? "loading" : studio.generationState}`} role="status" aria-live="polite"><span></span>{statusLine({ generationState: studio.generationState, status: studio.status, detailsUpdating: studio.detailsUpdating, terrainDataStale: studio.terrainDataStale, terrainDataAction: studio.terrainDataAction, verticalExaggerationStale: studio.verticalExaggerationStale, exportReady: studio.exportReady, exportBlockedBy: studio.exportBlockedBy, sourceKind: studio.geometry.sourceKind })}</div>
  {#if studio.embeddedInPlatform}
    {#if needsTerrain}<Button class="btn btn-secondary generate-retry" onclick={() => void generate()}>{studio.generationState === "error" ? t("place.tryAgain") : t("place.loadTerrain")}</Button>{/if}
  {:else if !studio.guideOpen || studio.generationState === "loading"}
  <!-- The setup guide starts Generate from its own steps, so the dock only offers to cancel one. -->
  <Button variant="primary" class="generate-button" onclick={() => studio.generationState === "loading" ? cancelGeneration() : void generate()}>{#if studio.generationState === "loading"}<X size={18} /> {t("place.cancelGeneration")}{:else}<Sparkles size={18} /> {studio.geometry.sourceKind === "real" ? studio.terrainDataStale ? t("place.regenerateTerrainData") : t("place.regenerateTerrain") : t("place.generateTerrain")}{/if}</Button>
  {/if}
</div>
