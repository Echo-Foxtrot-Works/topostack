<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  import { depthKindLabel, lakeStudioLink } from "$lib/site/lake-directory";
  import { LAKES_HOME } from "$lib/site/site";
  import type { LakeListing, LakePage } from "$lib/site/lake-pages";
  const base = basePath();

  let { page }: { page: LakePage } = $props();

  // Surveys can list separate basins under one name; coordinates tell them apart.
  const repeated = $derived.by(() => {
    const seen = new Map<string, number>();
    for (const lake of page.lakes) seen.set(lake.name, (seen.get(lake.name) ?? 0) + 1);
    return new Set([...seen].filter(([, count]) => count > 1).map(([name]) => name));
  });
  const groups = $derived.by(() => {
    const byPlace = new Map<string, LakeListing[]>();
    for (const lake of page.lakes) byPlace.set(lake.place ?? "", [...(byPlace.get(lake.place ?? "") ?? []), lake]);
    return [...byPlace].map(([place, lakes]) => ({ place, lakes }));
  });
  const byCounty = $derived(page.children.some((child) => child.label.endsWith(" County")));
  const listHeading = $derived(!page.children.length ? "Lakes with surveyed depth data" : byCounty ? "Lakes in other counties" : "Records published without a lake name");
  const detailed = $derived(page.lakes.some((lake) => lake.note));

  function coordinates([west, south, east, north]: LakeListing["bounds"]): string {
    const lat = (south + north) / 2;
    const lon = (west + east) / 2;
    return `${Math.abs(lat).toFixed(3)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(3)}° ${lon < 0 ? "W" : "E"}`;
  }
</script>

{#snippet lakeItem(lake: LakeListing)}
  <li>
    {#if lake.page}
      <a href={`${base}${lake.page}`}>{lake.name}</a> <a class="studio" href={lakeStudioLink(base, lake)} aria-label={`Open ${lake.name} in the studio`}>studio</a>
    {:else}
      <a href={lakeStudioLink(base, lake)}>{lake.name}</a>
    {/if}
    {#if lake.aliases?.length}<span class="meta">also {lake.aliases.join(", ")}</span>{/if}
    {#if repeated.has(lake.name)}<span class="meta">{coordinates(lake.bounds)}</span>{/if}
    {#if lake.note}<span class="note">{lake.note}</span>{/if}
  </li>
{/snippet}

<Article title={page.heading} intro={page.intro} trail={page.trail} static>
  <p>{page.about}</p>
  <p>Larger lakes link to a page with their survey facts and sizes; the <strong>studio</strong> link beside them, and every other lake name, opens the studio framed to that lake’s survey area and generates its terrain. You can also <a href={`${base}/guides/lake-depth-data`}>search every surveyed lake</a> or <a href={`${base}${LAKES_HOME}`}>browse other regions</a>.</p>

  {#if page.children.length}
    <h2>{byCounty ? "Browse by county" : "Browse by name"}</h2>
    <ul class="page-links">
      {#each page.children as child (child.path)}
        <li><a href={`${base}${child.path}`}>{child.label}</a> <span class="meta">{child.count.toLocaleString("en-US")} {child.count === 1 ? "lake" : "lakes"}</span></li>
      {/each}
    </ul>
  {/if}

  {#if page.largest.length > 1 && page.lakes.length > 12}
    <h2>Largest survey areas</h2>
    <ul class="lake-list featured">{#each page.largest as lake (lake.name)}{@render lakeItem(lake)}{/each}</ul>
  {/if}

  {#if page.lakes.length}
    <h2>{listHeading}</h2>
    {#each groups as group (group.place)}
      {#if group.place}<h3>{group.place}</h3>{/if}
      <ul class="lake-list" class:detailed>{#each group.lakes as lake, index (lake.name + index)}{@render lakeItem(lake)}{/each}</ul>
    {/each}
  {/if}

  <h2>Make a lake map from this data</h2>
  <ol>
    <li>Open a lake in the studio from the list. The studio frames its survey area, turns on <strong>Water depth</strong> and generates the terrain. Widen the frame and regenerate if you want more shoreline.</li>
    <li>Check the warnings above the preview. The studio warns when survey coverage is partial or depths are estimated; <a href={`${base}/guides/how-lake-depths-work`}>how lake depths work</a> explains why.</li>
    <li>Enter your sheet thickness in <strong>Terrain layers</strong>; the studio works out the layer count. If a deep lake needs more sheets than you want, <strong>Fit depth</strong> compresses it while keeping the shoreline. The <a href={`${base}/guides/custom-lake-depth-map`}>custom lake map guide</a> walks through the whole build.</li>
    <li>Turn on <a href={`${base}/guides/water-paint-templates`}>paint templates</a> to spray only the water on each layer, and <a href={`${base}/guides/split-large-maps`}>split the map</a> if it is bigger than your laser bed.</li>
    <li>Export the SVG layers. The download’s <strong>ATTRIBUTION.txt</strong> credits the survey used.</li>
  </ol>

  <h2>Data source</h2>
  <ul>
    {#each page.sources as source (source.url)}
      <li><a href={source.url}>{source.name}</a>: {depthKindLabel(source.kind).toLowerCase()}. {source.license}</li>
    {/each}
  </ul>
  <p>Survey dates and water levels vary between lakes, and a listing can cover only part of a lake. See <a href={`${base}/attribution#surveys`}>sources and attribution</a> for credits.</p>
</Article>

<style>
  /* A grid, not CSS columns: article list items carry a vertical margin that
     multi-column layout keeps only at the top of the first column, and WebKit
     splits a lone item's text from its underline across columns. */
  .page-links, .lake-list { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr)); column-gap: 32px; align-items: start; }
  .page-links li, .lake-list li { margin: 0; padding-block: 4px; line-height: 1.45; }
  .lake-list.detailed, .featured { grid-template-columns: 1fr; }
  .lake-list.detailed li { padding-block: 10px; border-bottom: 1px solid var(--loidolt-border); }
  .meta, .note { color: var(--loidolt-text-muted); font-size: 13px; }
  .meta { margin-left: 6px; }
  .studio { margin-left: 6px; font-size: 13px; }
  .note { display: block; }
  h3 { font-size: 17px; margin: 24px 0 4px; }
</style>
