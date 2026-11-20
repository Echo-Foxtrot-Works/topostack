<script lang="ts">
  import { onMount } from "svelte";
  import { basePath } from "$lib/site/paths";
  import { lakeStudioLink, searchLakes, type IndexedLake } from "$lib/site/lake-directory";
  import { uniqueOtherPlaces } from "$lib/site/location-results";
  import { lakeLocationFromSearch } from "$lib/site/lake-location";
  import { LocateFixed, Map as MapIcon, Mountain, Search } from "@lucide/svelte";
  import { Button, Field, IconButton, Input } from "@loidolt/theme-svelte";
  import NumberField from "$lib/studio/StudioNumberField.svelte";
  import type { ProjectConfigV1 } from "@topostack/core";
  import { searchPlaces, type PlaceResult } from "$lib/domain/geocode";
  import { clampLatitude, clampLongitude, isSupportedCoordinate, MAX_LATITUDE, MAX_LONGITUDE } from "$lib/domain/coordinates";
  import { loadLocationLakes } from "$lib/studio/lake-directory-cache";
  import { t } from "$lib/i18n/i18n.svelte";
  const base = basePath();

  let { project, presets, onChoose, onCoordinates, onClose }: { project: ProjectConfigV1; presets: PlaceResult[]; onChoose: (place: PlaceResult) => void; onCoordinates: (lat: number, lon: number) => void; onClose: () => void } = $props();
  let query = $state("");
  let results = $state.raw<PlaceResult[]>([]);
  let searchError = $state("");
  let placesLoading = $state(false);
  let locating = $state(false);
  let locationError = $state("");
  let locationRequest = 0;
  let dialog: HTMLDialogElement;
  let lakes = $state.raw<IndexedLake[]>([]);
  let lakesLoading = $state(true);
  let lakesFailed = $state(false);
  let lakePage = $state(1);
  const lakePageSize = 5;
  const matchedLakes = $derived(searchLakes(lakes, query));
  const otherPlaces = $derived(uniqueOtherPlaces(results, matchedLakes));
  const lakePageCount = $derived(Math.max(1, Math.ceil(matchedLakes.length / lakePageSize)));
  const currentLakePage = $derived(Math.min(lakePage, lakePageCount));
  const shownLakes = $derived(matchedLakes.slice((currentLakePage - 1) * lakePageSize, currentLakePage * lakePageSize));
  let lakeRequest = 0;
  // Copy around a link: the message places the link, so translations can move it.
  const LINK = "\u0000";
  const aroundLink = (message: string): [string, string] => { const [before = "", after = ""] = message.split(LINK); return [before, after]; };
  const lakeNote = $derived(aroundLink(t("place.lakeSearchNote", { link: LINK })));
  const attribution = $derived(aroundLink(t("place.placeSearchBy", { provider: LINK })));

  async function loadLakes(): Promise<void> {
    // The shared directory load keeps running after close so the next open reuses it.
    const request = ++lakeRequest;
    lakesLoading = true; lakesFailed = false;
    try {
      const indexed = await loadLocationLakes();
      if (request === lakeRequest) lakes = indexed;
    } catch { if (request === lakeRequest) lakesFailed = true; }
    finally { if (request === lakeRequest) lakesLoading = false; }
  }

  function chooseLake(lake: IndexedLake): void {
    const search = lakeStudioLink("", lake).split("?")[1]!;
    const location = lakeLocationFromSearch(`?${search}`, project.widthMm, project.heightMm);
    if (!location) return;
    onChoose({ id: lake.id, ...location, type: "surveyed lake", surveyedLake: true });
  }

  function changeLakePage(next: number): void {
    lakePage = next;
    const summary = dialog.querySelector<HTMLElement>(".lake-search-summary");
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({ block: "nearest" });
  }

  onMount(() => {
    dialog.showModal();
    void loadLakes();
    return () => { locationRequest++; lakeRequest++; if (dialog.open) dialog.close(); };
  });

  function closeFromBackdrop(event: MouseEvent): void {
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  }

  function useCurrentLocation(): void {
    if (locating) return;
    locationError = "";
    if (!navigator.geolocation) {
      locationError = t("place.geolocationUnavailable");
      return;
    }
    locating = true;
    const request = ++locationRequest;
    const isCurrent = () => request === locationRequest && dialog.open;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!isCurrent()) return;
      locating = false;
      if (!isSupportedCoordinate(coords.latitude, coords.longitude)) {
        locationError = t("place.geolocationOutside");
        return;
      }
      onCoordinates(coords.latitude, coords.longitude);
      dialog.close();
    }, (error) => {
      if (!isCurrent()) return;
      locating = false;
      locationError = error.code === 1
        ? t("place.geolocationDenied")
        : error.code === 3
          ? t("place.geolocationTimeout")
          : t("place.geolocationFailed");
    }, { timeout: 10000, maximumAge: 60000 });
  }

  /** Typing supersedes a pending current-location request without moving the map yet. */
  function cancelLocationRequest(): void {
    locationRequest++; locating = false; locationError = "";
  }

  /** Coordinates commit on change (blur, Enter, or a stepper), never per keystroke. */
  function commitCoordinate(value: number, axis: "lat" | "lon"): void {
    if (!Number.isFinite(value)) return;
    cancelLocationRequest();
    if (axis === "lat") onCoordinates(clampLatitude(value), project.location.lon);
    else onCoordinates(project.location.lat, clampLongitude(value));
  }

  $effect(() => {
    const term = query.trim();
    results = []; searchError = ""; placesLoading = false;
    if (term.length < 2) { results = []; searchError = ""; return; }
    const controller = new AbortController();
    placesLoading = true;
    const timeout = window.setTimeout(() => {
      void searchPlaces(term, controller.signal).then((items) => {
        if (!controller.signal.aborted) { results = items; searchError = items.length ? "" : t("place.noOtherPlaces"); }
      }).catch(() => {
        if (!controller.signal.aborted) searchError = t("place.placeSearchUnavailable");
      }).finally(() => { if (!controller.signal.aborted) placesLoading = false; });
    }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  });
</script>

<dialog bind:this={dialog} class="ldt-dialog ldt-dialog--lg search-modal" aria-labelledby="location-dialog-title" aria-describedby="location-dialog-description" onclose={onClose} onmousedown={closeFromBackdrop}>
  <header class="ldt-dialog__header"><div><h2 id="location-dialog-title" class="ldt-dialog__title">{t("place.chooseAnywhere")}</h2><p id="location-dialog-description" class="ldt-dialog__description">{t("place.chooseAnywhereDescription")}</p></div><IconButton label={t("place.closeDialog")} onclick={() => dialog.close()}>×</IconButton></header>
  <div class="ldt-dialog__body">
    <label class="search-input"><Search size={19} /><Input autofocus aria-label={t("place.searchPlaces")} bind:value={query} oninput={() => lakePage = 1} placeholder={t("place.searchPlaceholder")} boxed /></label>
    <div class="coordinate-row">
      <Field label={t("place.latitude")}>{#snippet children({ id })}<NumberField {id} label={t("place.latitude")} min={-MAX_LATITUDE} max={MAX_LATITUDE} step={0.0001} value={project.location.lat} boxed oninput={cancelLocationRequest} onValueChange={(value) => commitCoordinate(value, "lat")} />{/snippet}</Field>
      <Field label={t("place.longitude")}>{#snippet children({ id })}<NumberField {id} label={t("place.longitude")} min={-MAX_LONGITUDE} max={MAX_LONGITUDE} step={0.0001} value={project.location.lon} boxed oninput={cancelLocationRequest} onValueChange={(value) => commitCoordinate(value, "lon")} />{/snippet}</Field>
      <IconButton label={locating ? t("place.locating") : t("place.useCurrentLocation")} title={locating ? t("place.findingLocation") : t("place.useCurrentLocation")} disabled={locating} onclick={useCurrentLocation}><LocateFixed size={18} /></IconButton>
      <Button onclick={() => dialog.close()}>{t("place.useCoordinates")}</Button>
    </div>
    {#if locating}<p class="location-feedback" role="status">{t("place.findingLocation")}</p>{/if}
    {#if locationError}<p class="location-feedback" role="alert">{locationError}</p>{/if}
    <section class="surveyed-lake-search" aria-labelledby="surveyed-lake-search-title" aria-busy={lakesLoading}>
      <h3 id="surveyed-lake-search-title">{t("place.surveyedLakes")}</h3>
      {#if lakesLoading}
        <p role="status">{t("place.loadingLakes")}</p>
      {:else if lakesFailed}
        <p role="alert">{t("place.lakesFailed")}</p><Button onclick={() => void loadLakes()}>{t("place.retryLakes")}</Button>
      {:else}
        <p class="lake-search-summary" tabindex="-1" role="status">{query.trim() ? t("place.lakesMatching", { count: matchedLakes.length, query: query.trim() }) : t("place.lakesAvailable", { count: matchedLakes.length })}</p>
        <div class="search-results lake-search-results">
          {#each shownLakes as lake (lake.id)}
            <button class="location-option" data-lake-id={lake.id} onclick={() => chooseLake(lake)}>
              <span class="location-option__icon"><MapIcon size={17} /></span>
              <span class="location-option__copy"><strong data-i18n-skip>{lake.name}</strong><small>{t("place.lakeDetail", { region: lake.region, source: lake.source.name, surveyId: lake.surveyId })}</small></span>
            </button>
          {/each}
        </div>
        {#if lakePageCount > 1}
          <nav class="lake-search-pagination" aria-label={t("place.lakePages")}>
            <Button disabled={currentLakePage === 1} onclick={() => changeLakePage(currentLakePage - 1)}>{t("place.previousLakes")}</Button>
            <span>{t("place.pageOf", { page: currentLakePage, count: lakePageCount })}</span>
            <Button disabled={currentLakePage === lakePageCount} onclick={() => changeLakePage(currentLakePage + 1)}>{t("place.nextLakes")}</Button>
          </nav>
        {/if}
        <p class="lake-search-note">{lakeNote[0]}<a href={`${base}/guides/lake-depth-data`}>{t("place.browseLakeDirectory")}</a>{lakeNote[1]}</p>
      {/if}
    </section>
    <div class="search-results">
      {#if query.trim().length >= 2}<h3>{t("place.otherPlaces")}</h3>{/if}
      {#each otherPlaces as result (result.id)}
        <button class="location-option" onclick={() => onChoose(result)}>
          <span class="location-option__icon"><MapIcon size={17} /></span>
          <span class="location-option__copy" data-i18n-skip><strong>{result.label.split(",")[0]}</strong><small>{result.label.split(",").slice(1).join(",")}</small></span>
        </button>
      {/each}
      {#if placesLoading}<p role="status">{t("place.searchingOtherPlaces")}</p>{:else if searchError}<p role="status">{searchError}</p>{/if}
      {#if !query}
        <details class="preset-locations">
          <summary>{t("place.exampleLocations")}</summary>
          <div class="preset-grid">
            {#each presets as preset (preset.id)}
              <button class="location-option" onclick={() => onChoose(preset)}>
                <span class="location-option__icon"><Mountain size={19} /></span>
                <span class="location-option__copy" data-i18n-skip><strong>{preset.label.split(",")[0]}</strong><small>{preset.label.split(",").slice(1).join(",")}</small></span>
              </button>
            {/each}
          </div>
        </details>
      {/if}
    </div>
    <small class="provider-attribution">{attribution[0]}<a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" data-i18n-skip>Geoapify</a>{attribution[1]}</small>
  </div>
</dialog>

<style>
  /* Directory/search results must not move controls underneath a pointer. */
  .search-modal { height: min(720px, calc(100dvh - 32px)); }
  .search-modal :global(.search-results) { max-height: none; overflow: visible; padding-block: 0; }
  .preset-locations summary { cursor: pointer; font-size: 0.8125rem; }
  .preset-locations[open] summary { margin-bottom: 0.5rem; }
  .search-modal .location-option { min-height: 44px; padding-block: 5px; }
  .location-feedback { font-size: 0.8125rem; margin-block: 0.5rem; }
  .coordinate-row { grid-template-columns: repeat(2, minmax(0, 1fr)) auto auto; margin-top: 0.5rem; padding-bottom: 0.5rem; }
  @media (max-width: 600px) {
    .coordinate-row { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .coordinate-row > :global(button) { grid-column: auto; white-space: normal; }
  }
  .surveyed-lake-search { margin-block: 0.5rem; }
  h3 { font-size: 1rem; margin-block: 0 0.5rem; }
  .lake-search-summary, .lake-search-note { font-size: 0.8125rem; line-height: 1.4; margin-block: 0.5rem; }
  .lake-search-pagination { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; justify-content: space-between; margin-block: 0.5rem; font-size: 0.8125rem; }
</style>
