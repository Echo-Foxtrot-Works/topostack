<script lang="ts">
  import { onMount } from "svelte";
  import { base } from "$app/paths";
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
      locationError = "Current location is unavailable in this browser. Enter coordinates instead.";
      return;
    }
    locating = true;
    const request = ++locationRequest;
    const isCurrent = () => request === locationRequest && dialog.open;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (!isCurrent()) return;
      locating = false;
      if (!isSupportedCoordinate(coords.latitude, coords.longitude)) {
        locationError = "Your location is outside the supported map area. Enter coordinates instead.";
        return;
      }
      onCoordinates(coords.latitude, coords.longitude);
      dialog.close();
    }, (error) => {
      if (!isCurrent()) return;
      locating = false;
      locationError = error.code === 1
        ? "Location access was denied. Allow location access in your browser or enter coordinates."
        : error.code === 3
          ? "Finding your location timed out. Try again or enter coordinates."
          : "Your location could not be determined. Try again or enter coordinates.";
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
        if (!controller.signal.aborted) { results = items; searchError = items.length ? "" : "No other places found."; }
      }).catch(() => {
        if (!controller.signal.aborted) searchError = "Other place search is unavailable. You can still search surveyed lakes or enter coordinates.";
      }).finally(() => { if (!controller.signal.aborted) placesLoading = false; });
    }, 300);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  });
</script>

<dialog bind:this={dialog} class="ldt-dialog ldt-dialog--lg search-modal" aria-labelledby="location-dialog-title" aria-describedby="location-dialog-description" onclose={onClose} onmousedown={closeFromBackdrop}>
  <header class="ldt-dialog__header"><div><h2 id="location-dialog-title" class="ldt-dialog__title">Choose anywhere</h2><p id="location-dialog-description" class="ldt-dialog__description">Search for a mountain, lake, park, city, or address.</p></div><IconButton label="Close dialog" onclick={() => dialog.close()}>×</IconButton></header>
  <div class="ldt-dialog__body">
    <label class="search-input"><Search size={19} /><Input autofocus aria-label="Search places" bind:value={query} oninput={() => lakePage = 1} placeholder="Lake, place or survey ID" boxed /></label>
    <div class="coordinate-row">
      <Field label="Latitude">{#snippet children({ id })}<NumberField {id} label="Latitude" min={-MAX_LATITUDE} max={MAX_LATITUDE} step={0.0001} value={project.location.lat} boxed oninput={cancelLocationRequest} onValueChange={(value) => commitCoordinate(value, "lat")} />{/snippet}</Field>
      <Field label="Longitude">{#snippet children({ id })}<NumberField {id} label="Longitude" min={-MAX_LONGITUDE} max={MAX_LONGITUDE} step={0.0001} value={project.location.lon} boxed oninput={cancelLocationRequest} onValueChange={(value) => commitCoordinate(value, "lon")} />{/snippet}</Field>
      <IconButton label={locating ? "Locating…" : "Use current location"} title={locating ? "Finding your current location…" : "Use current location"} disabled={locating} onclick={useCurrentLocation}><LocateFixed size={18} /></IconButton>
      <Button onclick={() => dialog.close()}>Use coordinates</Button>
    </div>
    {#if locating}<p class="location-feedback" role="status">Finding your current location…</p>{/if}
    {#if locationError}<p class="location-feedback" role="alert">{locationError}</p>{/if}
    <section class="surveyed-lake-search" aria-labelledby="surveyed-lake-search-title" aria-busy={lakesLoading}>
      <h3 id="surveyed-lake-search-title">Surveyed lakes</h3>
      {#if lakesLoading}
        <p role="status">Loading surveyed lakes…</p>
      {:else if lakesFailed}
        <p role="alert">The surveyed lake list could not load.</p><Button onclick={() => void loadLakes()}>Retry lake search</Button>
      {:else}
        <p class="lake-search-summary" tabindex="-1" role="status">{matchedLakes.length.toLocaleString("en-US")} {matchedLakes.length === 1 ? "lake or basin" : "lakes and basins"}{query.trim() ? ` matching “${query.trim()}”` : " available"}</p>
        <div class="search-results lake-search-results">
          {#each shownLakes as lake (lake.id)}
            <button class="location-option" data-lake-id={lake.id} onclick={() => chooseLake(lake)}>
              <span class="location-option__icon"><MapIcon size={17} /></span>
              <span class="location-option__copy"><strong>{lake.name}</strong><small>{lake.region} · {lake.source.name} · Survey {lake.surveyId}</small></span>
            </button>
          {/each}
        </div>
        {#if lakePageCount > 1}
          <nav class="lake-search-pagination" aria-label="Surveyed lake pages">
            <Button disabled={currentLakePage === 1} onclick={() => changeLakePage(currentLakePage - 1)}>Previous lakes</Button>
            <span>Page {currentLakePage} of {lakePageCount}</span>
            <Button disabled={currentLakePage === lakePageCount} onclick={() => changeLakePage(currentLakePage + 1)}>Next lakes</Button>
          </nav>
        {/if}
        <p class="lake-search-note">Search by name, region, source or survey ID. Depth coverage varies by lake. <a href={`${base}/guides/lake-depth-data`}>Browse the lake directory</a>.</p>
      {/if}
    </section>
    <div class="search-results">
      {#if query.trim().length >= 2}<h3>Other places</h3>{/if}
      {#each otherPlaces as result (result.id)}
        <button class="location-option" onclick={() => onChoose(result)}>
          <span class="location-option__icon"><MapIcon size={17} /></span>
          <span class="location-option__copy"><strong>{result.label.split(",")[0]}</strong><small>{result.label.split(",").slice(1).join(",")}</small></span>
        </button>
      {/each}
      {#if placesLoading}<p role="status">Searching other places…</p>{:else if searchError}<p role="status">{searchError}</p>{/if}
      {#if !query}
        <details class="preset-locations">
          <summary>Example locations</summary>
          <div class="preset-grid">
            {#each presets as preset (preset.id)}
              <button class="location-option" onclick={() => onChoose(preset)}>
                <span class="location-option__icon"><Mountain size={19} /></span>
                <span class="location-option__copy"><strong>{preset.label.split(",")[0]}</strong><small>{preset.label.split(",").slice(1).join(",")}</small></span>
              </button>
            {/each}
          </div>
        </details>
      {/if}
    </div>
    <small class="provider-attribution">Place search by <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer">Geoapify</a> · © OpenStreetMap contributors</small>
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
