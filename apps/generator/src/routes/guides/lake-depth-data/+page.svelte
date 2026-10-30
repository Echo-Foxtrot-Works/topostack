<script lang="ts">
  import { onMount } from "svelte";
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  import { depthKindLabel, indexLakeDirectory, lakeStudioLink, searchLakes, type LakeDirectory } from "$lib/site/lake-directory";
  const base = basePath();

  let directory = $state.raw<LakeDirectory>();
  /** Lake id → slug of its own page. Optional: without it, results still open in the studio. */
  let lakePages = $state.raw<Record<string, string>>({});
  let loading = $state(true);
  let failed = $state(false);
  let query = $state("");
  let region = $state("");
  let kind = $state("");
  let pageNumber = $state(1);
  const pageSize = 25;
  const lakes = $derived(directory ? indexLakeDirectory(directory) : []);
  const regions = $derived([...new Set(directory?.sources.map((source) => source.group) ?? [])].sort());
  const results = $derived(searchLakes(lakes, query, region, kind));
  const pageCount = $derived(Math.max(1, Math.ceil(results.length / pageSize)));
  const currentPage = $derived(Math.min(pageNumber, pageCount));
  const shown = $derived(results.slice((currentPage - 1) * pageSize, currentPage * pageSize));

  async function loadDirectory(signal?: AbortSignal): Promise<void> {
    loading = true; failed = false;
    try {
      const response = await fetch(`${base}/data/lake-depth-directory.json`, { signal });
      if (!response.ok) throw new Error("Directory unavailable");
      const data = await response.json() as LakeDirectory;
      if (data.schemaVersion !== 1 || !Array.isArray(data.lakes) || !Array.isArray(data.sources)) throw new Error("Invalid directory");
      indexLakeDirectory(data);
      directory = data;
    } catch { if (!signal?.aborted) failed = true; }
    finally { if (!signal?.aborted) loading = false; }
  }
  async function loadLakePages(signal: AbortSignal): Promise<void> {
    try {
      const response = await fetch(`${base}/data/lake-pages.json`, { signal });
      const data = response.ok ? await response.json() as { schemaVersion?: number; pages?: unknown } : undefined;
      if (data?.schemaVersion === 1 && data.pages && typeof data.pages === "object") lakePages = data.pages as Record<string, string>;
    } catch { /* The search works without page links. */ }
  }
  onMount(() => {
    const controller = new AbortController();
    void loadDirectory(controller.signal);
    void loadLakePages(controller.signal);
    return () => controller.abort();
  });
  function resetSearch(): void { query = ""; region = ""; kind = ""; pageNumber = 1; }
  function changePage(next: number): void {
    pageNumber = next;
    const summary = document.getElementById("lake-results");
    summary?.focus({ preventScroll: true });
    summary?.scrollIntoView({ block: "start" });
  }
  function coordinates(bounds: number[]): string {
    const lat = (bounds[1]! + bounds[3]!) / 2;
    const lon = (bounds[0]! + bounds[2]!) / 2;
    return `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? "W" : "E"}`;
  }
</script>

<Article title="Lakes with surveyed depth data" intro="Find lake-floor data included in TopoStack. Search by lake name, region, survey ID or data source, then open a location in the studio.">
  <div class="coverage-note">
    <strong>Real surveys, with different levels of detail.</strong>
    <p>Surveyed grids describe the lake floor from published bathymetric data. Survey contours use measured depth lines with the spaces between them interpolated. A listing may cover only part of a lake; gaps use existing terrain or modeled depths where possible and otherwise stay at the waterline. Check the studio’s warnings after generating.</p>
  </div>
  <p>Wondering how the lake floor is made? <a href={`${base}/guides/how-lake-depths-work`}>Learn how surveys, predictions, and depth settings work</a>. Prefer to browse? See <a href={`${base}/lakes`}>lake depth maps by region</a>, with Minnesota listed by county.</p>
  <section class="directory" aria-label="Search surveyed lakes" aria-busy={loading}>
    <div class="search-field">
      <label for="lake-search">Search lakes</label>
      <input id="lake-search" type="search" bind:value={query} oninput={() => pageNumber = 1} placeholder="Lake name, county, source or survey ID" />
    </div>
    <div class="filters">
      <div><label for="lake-region">Region</label><select id="lake-region" bind:value={region} onchange={() => pageNumber = 1}><option value="">All regions</option>{#each regions as option}<option value={option}>{option}</option>{/each}</select></div>
      <div><label for="lake-kind">Depth data</label><select id="lake-kind" bind:value={kind} onchange={() => pageNumber = 1}><option value="">All survey types</option><option value="grid">Surveyed grids</option><option value="contours">Survey contours</option></select></div>
    </div>
    <div class="suggestions"><span>Try</span>{#each ["Crater Lake", "Tahoe", "Minnetonka", "Lake Geneva"] as example}<button type="button" onclick={() => { resetSearch(); query = example; }}>{example}</button>{/each}</div>
    <noscript><p>Enable JavaScript to search the directory, or <a href={`${base}/data/lake-depth-directory.json`}>download the complete lake list</a>.</p></noscript>
    {#if loading}
      <p role="status">Loading the lake directory…</p>
    {:else if failed}
      <p role="alert">The lake directory couldn’t load. Please try again.</p><button class="directory-button" type="button" onclick={() => void loadDirectory()}>Retry</button>
    {:else if directory}
      <div id="lake-results" class="result-summary" role="status" aria-live="polite" tabindex="-1"><strong>{results.length.toLocaleString("en-US")} {results.length === 1 ? "lake or basin" : "lakes and basins"}</strong><span>of {lakes.length.toLocaleString("en-US")} records · {directory.sources.length} datasets</span></div>
      {#if results.length}
        <ul class="lake-list">
          {#each shown as lake (lake.id)}
            <li>
              <div class="lake-heading"><h2>{lake.name}</h2><span class="data-kind">{depthKindLabel(lake.source.kind)}</span></div>
              <p class="lake-region">{lake.region}</p>
              <p class="lake-meta">{coordinates(lake.bounds)} · Survey {lake.surveyId}</p>
              {#if lake.aliases?.length}<p class="lake-meta">Also listed as {lake.aliases.join(" · ")}</p>{/if}
              {#if lake.note}<p class="lake-meta">{lake.note}</p>{/if}
              <div class="lake-links"><a class="studio-link" href={lakeStudioLink(base, lake)} data-sveltekit-reload>Open in studio <span aria-hidden="true">↗</span><span class="ldt-visually-hidden">: {lake.name}</span></a>{#if lakePages[lake.id]}<a class="page-link" href={`${base}/lake/${lakePages[lake.id]}`} data-sveltekit-reload>Lake page<span class="ldt-visually-hidden">: {lake.name}</span></a>{/if}<a class="source-link" href={lake.source.url} target="_blank" rel="noreferrer">{lake.source.name}<span class="ldt-visually-hidden"> (source, opens in a new tab)</span></a></div>
            </li>
          {/each}
        </ul>
        <nav class="pagination" aria-label="Lake directory pages">
          <button type="button" disabled={currentPage === 1} onclick={() => changePage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage} of {pageCount}</span>
          <button type="button" disabled={currentPage === pageCount} onclick={() => changePage(currentPage + 1)}>Next</button>
        </nav>
      {:else}
        <div class="empty-results"><h2>No matching lakes</h2><p>Try another spelling, a nearby region, or the survey ID. Accented letters such as é match their plain form; letters such as ø and æ must be typed as written.</p><button class="directory-button" type="button" onclick={resetSearch}>Clear search and filters</button></div>
      {/if}
      <p class="catalog-date">Catalog updated {directory.updated}. Regional datasets can list separate basins of the same lake. <a href={`${base}/data/lake-depth-directory.json`} download>Download the complete list</a>.</p>
    {/if}
  </section>
  <p><a href={`${base}/attribution#surveys`}>View survey credits and how each source is used</a>.</p>
  <h2>Using a lake’s depth data</h2>
  <p>Select <strong>Open in studio</strong> to frame the survey area; the studio turns on <strong>Water depth</strong> and generates the terrain as it opens. Some small lakes may lack a matching lake outline. The studio warns when a lake has incomplete survey coverage or estimated depths, and the exported <strong>ATTRIBUTION.txt</strong> credits the surveys used.</p>
  <p>If a deep lake exceeds the available layers, choose <strong>Fit depth</strong> in the warning, or turn on <strong>Fit lake depth to available layers</strong>, to compress its depths while keeping the shoreline fixed. <strong>Use manual depth</strong> restores your requested scale. See the <a href={`${base}/guides/laser-cut-topographic-map`}>layered map guide</a> for fabrication steps.</p>
  <details class="source-notes"><summary>Sources and coverage notes</summary>
    <p>These are the survey datasets integrated into TopoStack. Survey dates, resolutions and water-level references vary; <a href={`${base}/guides/how-lake-depths-work#surveys`}>how surveys become a lake floor</a> explains the caveats. Source credits and applied depth scaling are included in exports.</p>
    {#if directory}<ul>{#each directory.sources as source}<li><a href={source.url}>{source.name}</a> — {depthKindLabel(source.kind)}. {source.license}</li>{/each}</ul>{/if}
  </details>
  <p>For British Columbia, the <a href="https://open.canada.ca/data/en/dataset/1427d389-cd21-4fe2-8ed9-282d9bdcb7e2">open bathymetric map collection</a> provides PDF depth maps for reference. These maps are not yet available as lake-floor geometry in the studio.</p>
</Article>

<style>
  .coverage-note { padding: 20px; border-left: 3px solid var(--loidolt-accent); background: var(--loidolt-surface); }
  .coverage-note p { margin-bottom: 0; }
  .directory { margin-block: 32px; }
  .search-field, .filters > div { display: grid; gap: 8px; }
  label { font-size: 14px; font-weight: 600; }
  input, select { width: 100%; min-height: 48px; box-sizing: border-box; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); background: var(--loidolt-surface); color: var(--loidolt-text); padding: 12px; font: inherit; }
  input:focus-visible, select:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 3px; }
  .filters { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px; }
  .suggestions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; font-size: 13px; }
  button { min-height: 44px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); background: var(--loidolt-surface); color: var(--loidolt-text); padding: 8px 14px; font: inherit; cursor: pointer; }
  button:hover:not(:disabled) { border-color: var(--loidolt-accent); }
  button:disabled { opacity: 0.45; cursor: default; }
  .result-summary { display: flex; flex-wrap: wrap; gap: 8px 16px; justify-content: space-between; padding-block: 24px 12px; font-size: 14px; }
  .result-summary span, .lake-meta, .catalog-date { color: var(--loidolt-text-muted); }
  .lake-list { list-style: none; margin: 0; padding: 0; }
  .lake-list li { margin: 0; padding: 24px 0; border-top: 1px solid var(--loidolt-border); }
  .lake-heading { display: flex; align-items: start; flex-wrap: wrap; gap: 10px; justify-content: space-between; }
  .lake-heading h2 { margin: 0; font-size: 22px; overflow-wrap: anywhere; }
  .data-kind { flex-shrink: 0; padding: 3px 8px; background: var(--loidolt-surface); border: 1px solid var(--loidolt-border); font-size: 12px; }
  .lake-region { margin: 6px 0; }
  .lake-meta { font-size: 13px; margin: 4px 0; overflow-wrap: anywhere; }
  .lake-links { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; margin-top: 12px; }
  .studio-link { display: inline-flex; align-items: center; gap: 12px; min-height: 44px; box-sizing: border-box; padding: 10px 14px; background: var(--loidolt-accent); color: var(--loidolt-on-accent) !important; text-decoration: none; font-size: 14px; }
  .page-link { font-size: 14px; font-weight: 600; }
  .source-link { font-size: 13px; }
  .pagination { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-block: 20px; font-size: 14px; }
  .catalog-date { font-size: 13px; }
  .source-notes { margin-top: 24px; }
  summary { cursor: pointer; font-weight: 600; padding-block: 12px; }
  @media (max-width: 520px) { .filters { grid-template-columns: 1fr; } }
</style>
