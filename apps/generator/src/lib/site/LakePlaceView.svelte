<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  import LakeDepthPreview from "$lib/site/LakeDepthPreview.svelte";
  import LakeLocator from "$lib/site/LakeLocator.svelte";
  import type { LakePreview } from "$lib/site/lake-pages.server";
  import type { LocatorMap } from "$lib/site/lake-locator";
  import { depthKindLabel } from "$lib/site/lake-directory";
  import type { LakePlace } from "$lib/site/lake-places";
  const base = basePath();

  let { page, locator, preview }: { page: LakePlace; locator?: LocatorMap; preview?: LakePreview } = $props();

  const listPage = $derived(page.trail.at(-2));
  const coordinates = $derived(`${Math.abs(page.center.lat).toFixed(4)}° ${page.center.lat < 0 ? "S" : "N"}, ${Math.abs(page.center.lon).toFixed(4)}° ${page.center.lon < 0 ? "W" : "E"}`);
  const km = (value: number): string => value >= 10 ? value.toFixed(0) : value >= 1 ? value.toFixed(1) : value.toFixed(2);
  const inches = (mm: number): string => (mm / 25.4).toFixed(1).replace(/\.0$/, "");
</script>

<Article title={page.heading} intro={page.intro} trail={page.trail} static>
  <p class="open"><a class="start" href={`${base}${page.studioPath}`}>Open {page.name} in the studio</a></p>
  <p>The studio frames the survey area, turns on <strong>Water depth</strong> and generates the terrain, ready to adjust and export as SVG layers.</p>
  {#if preview}<LakeDepthPreview {preview} name={page.name} />{/if}
  {#if locator}<LakeLocator map={locator} name={page.name} place={page.place} />{/if}

  <h2>Survey facts</h2>
  <table>
    <tbody>
      <tr><th scope="row">Location</th><td>{page.place}</td></tr>
      {#if page.aliases.length}<tr><th scope="row">Also known as</th><td>{page.aliases.join(", ")}</td></tr>{/if}
      <tr><th scope="row">Centre</th><td>{coordinates}</td></tr>
      <tr><th scope="row">Survey area</th><td>{km(page.extentKm.width)} km east–west × {km(page.extentKm.height)} km north–south</td></tr>
      <tr><th scope="row">Depth data</th><td>{depthKindLabel(page.kind)}</td></tr>
      <tr><th scope="row">Source</th><td><a href={page.source.url}>{page.source.name}</a>. {page.source.license}</td></tr>
    </tbody>
  </table>
  {#if page.note}<p class="note">{page.note}</p>{/if}

  <h2>Sizing a piece</h2>
  <p>Framed to the whole survey area, the map keeps its {page.extentKm.width >= page.extentKm.height ? "landscape" : "portrait"} shape. These are the scales at three common sizes. A tighter frame zooms in and a wider one adds shoreline, and the studio recalculates both.</p>
  <table>
    <thead><tr><th scope="col">Piece size</th><th scope="col">Map scale</th></tr></thead>
    <tbody>
      {#each page.plans as plan (plan.widthMm)}
        <tr><td>{Math.round(plan.widthMm)} × {Math.round(plan.heightMm)} mm ({inches(plan.widthMm)} × {inches(plan.heightMm)} in)</td><td>about 1:{plan.scale.toLocaleString("en-US")}</td></tr>
      {/each}
    </tbody>
  </table>
  <p>Your sheet thickness sets the number of layers. If the lake needs more sheets than you want to cut, <strong>Fit depth</strong> compresses the lake floor and keeps the shoreline. If the piece is bigger than your laser bed, <a href={`${base}/guides/split-large-maps`}>split it into interlocking pieces</a>.</p>

  {#if page.nearby.length}
    <h2>Nearby lakes with depth data</h2>
    <ul class="nearby">
      {#each page.nearby as lake (lake.href)}
        <li><a href={`${base}${lake.href}`}>{lake.name}</a> <span class="meta">{lake.distanceKm < 1 ? "under 1" : km(lake.distanceKm)} km{lake.hasPage ? "" : " · opens in the studio"}</span></li>
      {/each}
    </ul>
  {/if}

  <h2>More about lake maps</h2>
  <ul>
    <li><a href={`${base}/guides/custom-lake-depth-map`}>Make a custom lake depth map</a>: the whole build, from framing to glue-up.</li>
    <li><a href={`${base}/guides/how-lake-depths-work`}>How lake depths work</a>: surveyed, charted and modelled depths, and what the studio's warnings mean.</li>
    <li><a href={`${base}/guides/water-paint-templates`}>Paint templates</a> for spraying only the water on each layer.</li>
    {#if listPage}<li><a href={`${base}${listPage.path}`}>{listPage.label}</a>: more lakes from the same survey.</li>{/if}
  </ul>
  <p>Survey dates and water levels vary, and a survey can cover only part of a lake. Exports include an <strong>ATTRIBUTION.txt</strong> crediting the source; see <a href={`${base}/attribution#surveys`}>sources and attribution</a>. Depth data is decorative source material, not for navigation.</p>
</Article>

<style>
  .open { margin-top: 8px; }
  .start { display: inline-flex; align-items: center; min-height: 44px; background: var(--loidolt-accent); color: var(--loidolt-on-accent) !important; padding: 10px 18px; border-radius: var(--loidolt-border-radius); text-decoration: none; font-size: 15px; font-weight: 600; }
  .start:hover { background: var(--loidolt-accent-hover); }
  /* Fixed layout and anywhere-wrapping keep long licence URLs inside a phone-width column. */
  table { width: 100%; table-layout: fixed; border-collapse: collapse; margin: 8px 0 16px; font-size: 15px; }
  td { overflow-wrap: anywhere; }
  th, td { text-align: left; vertical-align: top; padding: 10px 12px 10px 0; border-bottom: 1px solid var(--loidolt-border); line-height: 1.5; }
  tbody th { width: 34%; font-weight: 600; }
  thead th { font-size: 13px; color: var(--loidolt-text-muted); font-weight: 600; }
  .nearby { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); column-gap: 32px; }
  .nearby li { margin: 0; padding-block: 4px; }
  .meta { color: var(--loidolt-text-muted); font-size: 13px; margin-left: 6px; }
</style>
