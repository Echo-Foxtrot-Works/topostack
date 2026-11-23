<script lang="ts">
  import { onDestroy, onMount, untrack } from "svelte";
  import { Button } from "@loidolt/theme-svelte";
  import { exportBlockMessage, projectFingerprint } from "@topostack/core";
  import { exportBlockText } from "$lib/i18n/warnings";
  import { errorText } from "$lib/i18n/errors";
  import { t } from "$lib/i18n/i18n.svelte";
  import { basePath } from "$lib/site/paths";
  import ShareArtwork from "$lib/studio/ShareArtwork.svelte";
  import { COMPOSITIONS, composeMap, type CompositionPreview, type MapComposition } from "$lib/studio/map-compositions";
  import { PreviewPipeline } from "$lib/studio/preview-pipeline";
  import { createSourcePreparation } from "$lib/studio/source-preparation";
  import { getStudio } from "$lib/studio/studio-context";

  let { onClose }: { onClose: () => void } = $props();
  const studio = getStudio();
  const original = untrack(() => studio.project);
  const pipeline = new PreviewPipeline();
  const sources = createSourcePreparation();
  let dialog: HTMLDialogElement;
  let choice = $state<MapComposition>("streets");
  let candidate = $state.raw<CompositionPreview>();
  let error = $state("");
  const unchanged = $derived(candidate?.geometry === studio.geometry);
  const blocked = $derived(candidate && exportBlockText(exportBlockMessage(candidate.geometry, candidate.project)));
  const missingSubject = $derived.by(() => {
    if (!candidate) return false;
    const { geometry } = candidate;
    if (choice === "streets") return !geometry.layers.some(layer => layer.markings.some(mark => mark.kind === "road" || mark.kind === "building"));
    if (choice === "shoreline") return !geometry.waterPatternAreas.length && !geometry.layers.some(layer => layer.markings.some(mark => mark.kind === "water"));
    return false;
  });

  function compare(next: MapComposition, retry = false): void {
    pipeline.invalidate();
    choice = next;
    candidate = undefined;
    error = "";
    const project = composeMap(original, next);
    if (retry) sources.clear();
    if (!retry && projectFingerprint(project) === studio.geometry.configFingerprint) {
      candidate = { project, source: studio.activeSource, geometry: studio.geometry };
      return;
    }
    void pipeline.runPreviewUpdate({
      config: project,
      prepareSource: signal => sources.prepare(studio.activeSource, studio.sourceProject, project, project, signal),
      onCommit: (geometry, source) => { candidate = { project, source, geometry }; },
      onError: cause => { error = errorText(cause, t("status.outputGeometryFailed")); },
      onSettled: () => {},
    });
  }

  onMount(() => {
    dialog.showModal();
    const counts = studio.detailCounts;
    const hasWater = counts.water > 0 || studio.geometry.waterSurfaces.length > 0 || studio.geometry.waterPatternAreas.length > 0;
    const preferred = counts.road || counts.rail || counts.building ? "streets" : hasWater ? "shoreline" : "terrain";
    const sameDesign = projectFingerprint(composeMap(original, preferred)) === studio.geometry.configFingerprint;
    compare(sameDesign ? (preferred === "terrain" ? "streets" : "terrain") : preferred);
  });
  onDestroy(() => pipeline.dispose());

  function apply(): void {
    if (!candidate || unchanged || Boolean(blocked)) return;
    studio.applyComposition(original, candidate);
    dialog.close();
    onClose();
  }
</script>

<dialog bind:this={dialog} class="ldt-dialog composition-dialog" aria-labelledby="composition-title" onclose={onClose}>
  <header class="ldt-dialog__header"><h2 class="ldt-dialog__title" id="composition-title">{t("place.compareCompositions")}</h2></header>
  <div class="composition-pair">
    <figure>
      <figcaption>{t("place.currentDesign")}</figcaption>
      <div class="composition-art"><ShareArtwork geometry={studio.geometry} project={original} /></div>
    </figure>
    <figure>
      <figcaption><select aria-label={t("place.compareCompositions")} value={choice} onchange={event => compare(event.currentTarget.value as MapComposition)}>
        {#each COMPOSITIONS as option}<option value={option}>{t(`place.composition.${option}`)}</option>{/each}
      </select></figcaption>
      <div class="composition-art" aria-busy={!candidate && !error}>
        {#if candidate}<ShareArtwork geometry={candidate.geometry} project={candidate.project} />
        {:else if error}<p role="alert">{error} <button type="button" onclick={() => compare(choice, true)}>{t("app.retry")}</button></p>
        {:else}<p role="status">{t("status.busyRefreshing")}</p>{/if}
      </div>
    </figure>
  </div>
  {#if blocked}
    <p class="composition-note" role="status">{blocked} <button type="button" onclick={() => compare(choice, true)}>{t("app.retry")}</button></p>
  {:else if missingSubject}
    <p class="composition-note" role="status">{t("place.noCompositionFeatures")}</p>
  {/if}
  <footer>
    <small><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · <a href={`${basePath()}/attribution${import.meta.env.VITE_SITE_ENV === "atomm" ? ".html" : ""}`} target="_blank" rel="noreferrer">{t("preview.allSources")}</a></small>
    <Button onclick={() => dialog.close()}>{t("place.cancel")}</Button>
    <Button variant="primary" disabled={!candidate || unchanged || Boolean(blocked)} onclick={apply}>{t("place.applyComposition")}</Button>
  </footer>
</dialog>

<style>
  .composition-dialog { position: fixed; inset: 0; margin: auto; transform: none; width: min(860px, calc(100% - 24px)); max-width: none; height: fit-content; max-height: calc(100dvh - 24px); overflow: auto; padding: 0; }
  .composition-pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 16px; }
  figure { margin: 0; min-width: 0; }
  figcaption { min-height: 40px; display: flex; align-items: center; font-weight: 600; }
  select { width: 100%; min-width: 0; padding: 6px; font: inherit; background: var(--loidolt-surface-input); color: inherit; border: 1px solid var(--loidolt-border); }
  .composition-art { position: relative; height: clamp(180px, 45vh, 420px); display: grid; place-items: center; overflow: hidden; background: var(--loidolt-surface-sunken); }
  .composition-art p, .composition-note { margin: 0; padding: 8px 16px; }
  footer { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px; padding: 8px 16px 16px; }
  footer small { margin-inline-end: auto; }
  @media (max-width: 550px) {
    .composition-pair { padding: 8px; gap: 6px; }
    .composition-art { height: clamp(150px, 57vw, 280px); }
    figcaption { font-size: 13px; }
    footer small { width: 100%; }
  }
</style>
