<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  import LakeDepthDemo from "$lib/site/LakeDepthDemo.svelte";
  import type { PageData } from "./$types";
  const base = basePath();
  let { data }: { data: PageData } = $props();
</script>

<Article title="How lake depths work" intro="A lake outline tells us where the water is, but not what lies beneath it. TopoStack combines published surveys, lake information, and surrounding terrain to build a lake floor for your map.">
  <p class="note"><strong>Survey data comes first.</strong> Where it is missing, we can estimate a lake floor. The studio warns you when depths include predictions, and exports retain that distinction.</p>
  <nav class="contents" aria-label="On this page">
    <a href="#sources">Data sources</a><a href="#surveys">Using surveys</a><a href="#predictions">Predicting depth</a><a href="#layers">Turning depth into layers</a><a href="#confidence">What to trust</a>
  </nav>

  <section id="sources" aria-labelledby="sources-title">
    <h2 id="sources-title">Three kinds of information, different jobs</h2>
    <div class="source-types">
      <div><span class="eyebrow">The shape on land</span><h3>Terrain and shorelines</h3><p><a href="https://registry.opendata.aws/terrain-tiles/">Mapzen elevation tiles</a>, plus higher-resolution lidar terrain where available, describe the surrounding land. Lake outlines locate the water and islands. An ordinary terrain map often shows a lake as a flat surface, so it cannot reveal its floor by itself.</p></div>
      <div><span class="eyebrow">Evidence underwater</span><h3>Published surveys</h3><p>Bathymetry is the underwater equivalent of topography. Survey datasets provide either a grid of lake-floor values or contour lines connecting equal depths.</p></div>
      <div><span class="eyebrow">When a survey is missing</span><h3>Depth estimates</h3><p>Maximum and average depth estimates constrain a predicted basin. Nearby slopes help vary its shape. A known maximum depth alone does not tell us the shape of the entire floor.</p></div>
    </div>
    <p><a href="https://www.hydrosheds.org/products/hydrolakes">HydroLAKES</a> supplies lake outlines, identifiers, surface elevations, and estimated average depths. <a href="https://doi.org/10.1038/s41597-022-01132-9">GLOBathy</a> supplies maximum depths, using reported measurements where available and model estimates elsewhere. TopoStack builds its own predicted floor from these inputs; we do not simply display GLOBathy’s depth rasters.</p>
    <details>
      <summary>Explore the integrated survey sources</summary>
      <p>Coverage is regional and can be partial. A source appearing here does not mean every lake in that region is covered.</p>
      <ul class="provider-list">
        {#each data.sources as source (source.id)}
          <li><a href={source.url}>{source.name}</a><span>{source.region} · {source.kind === "grid" ? "Surveyed grids" : "Survey contours"}</span></li>
        {/each}
      </ul>
    </details>
    <p>If your lake has no survey but you have a printed depth chart of it, you can <a href={`${base}/guides/trace-a-depth-chart`}>review and trace the chart in the studio</a> and carve the lake from it. The chart needs contour confirmation, geographic alignment, and a separate layer review. See <a href={`${base}/guides/how-depth-chart-tracing-works`}>how chart tracing works</a> for interpolation choices and current limits.</p>
    <p><a href={`${base}/guides/lake-depth-data`}>Find your lake in the surveyed-depth directory</a>, or visit <a href={`${base}/attribution#surveys`}>source credits and processing notes</a> for dataset-specific details.</p>
  </section>

  <section id="surveys" aria-labelledby="surveys-title">
    <h2 id="surveys-title">How surveys become a usable lake floor</h2>
    <ol class="process">
      <li><strong>Prepare the published data.</strong> We convert supported source formats and units into map tiles. Some surveys report depth below a reference waterline; others report the floor’s elevation. We convert elevations to depths using the dataset’s reference water level, except for Swiss lakes, which are aligned approximately to the lake surface elevation from HydroLAKES.</li>
      <li><strong>Fill between measured contours.</strong> Where a source provides depth lines, we interpolate the spaces between them into a continuous surface. Those in-between values are calculated from survey evidence, not individually measured points. We limit interpolation to supported coverage and water boundaries.</li>
      <li><strong>Match your map.</strong> The browser loads the tiles for your area and aligns them with the terrain grid. Lake outlines keep depths out of surrounding land and islands. Depths are positioned beneath the map’s lake waterline.</li>
      <li><strong>Keep track of gaps.</strong> Available survey values take precedence. Other providers may fill uncovered cells. Remaining gaps use existing underwater terrain or a modeled basin when enough information exists. Without a depth estimate, a narrow unsurveyed strip along the shore tapers from nearby survey depths; anything else remains at the waterline.</li>
    </ol>
    <p>A lake can therefore contain both survey data and estimates. That is <strong>mixed coverage</strong>. We preserve the distinction rather than describing the whole lake as measured.</p>
    <p>Survey dates, detail, and reference water levels vary. For example, NOAA’s Lake Superior grid is a draft, and Swiss floor elevations use an approximate alignment to the lake surface. These datasets do not represent today’s water level. <a href={`${base}/attribution#surveys`}>Source credits</a> list the reference level used for each dataset.</p>
  </section>

  <section id="predictions" aria-labelledby="predictions-title">
    <h2 id="predictions-title">How we predict a lake without a survey</h2>
    <p>We start with the shoreline and an available maximum depth. Distance from shore provides a basic basin: shallow at the edge and deeper inward. Then we look at the dry terrain just outside the lake.</p>
    <p><strong>Steep banks suggest faster drop-offs; gentle banks suggest broader shallows.</strong> We sample several nearby points, reduce the influence of isolated terrain spikes, and blend the slope influence into a continuous floor. The deepest point can move toward a steep bank instead of always sitting in the geometric center.</p>
    <p>The maximum depth limits the basin, and the estimated average depth helps shape its overall fullness. A shallow bowl and a steep-sided basin can have the same maximum depth but very different average depths.</p>
    <LakeDepthDemo />
    <p>If the terrain offers little useful variation, or the lake reaches the edge of the map, we keep the simpler distance-from-shore profile. Include the <strong>whole lake and a margin of surrounding land</strong> to give the terrain-based prediction useful context. Without a usable maximum depth, we cannot generate a fully modeled basin; a crop with no visible shoreline may also lack enough information.</p>
    <details>
      <summary>A little more about the algorithms</summary>
      <p>We measure how far each water sample lies from shore, in ground meters: from the lake outline for a complete lake when <strong>Smooth contours</strong> is on, or with a grid distance transform otherwise. For suitable complete lakes, we estimate slopes along short outward sampling lines, soften extreme values, and propagate their influence inward. A numerical solver joins opposing slopes into a continuous floor. We then scale the result to the depth constraint and fit a curve to the mean-depth estimate where available.</p>
      <p>The fallback uses a power curve of normalized distance from shore, measured against the whole lake’s size when that is known. Cropped lakes, and lakes without an average depth, use a straight cone: we skip average-depth fitting because the visible portion is not a fair sample of the entire basin. This is a deterministic geometric model, not a generative-AI reconstruction.</p>
    </details>
  </section>

  <section id="layers" aria-labelledby="layers-title">
    <h2 id="layers-title">Why your finished layers can look different</h2>
    <p>The lake floor is carved into the elevation grid before we generate contours. Those contours become holes and recesses in the stacked sheets. The same resulting geometry drives the preview and cut files.</p>
    <dl class="settings">
      <div><dt>Depth exaggeration</dt><dd>Scales surveyed and predicted floors relative to their waterlines, from 0.25× to 4×. At 4×, a 20 m depth is displayed as 80 m. It also applies to sea floors in coastal maps. This improves visibility; it does not improve the source data.</dd></div>
      <div><dt>Maximum depth</dt><dd>Appears for lakes that are modeled at least in part and have a published depth estimate. It changes the depth constraint for the modeled basin, including modeled survey gaps. The published average depth is kept, so a new maximum also changes the basin’s shape. It does not replace measured survey samples or existing underwater terrain, or turn a prediction into a survey.</dd></div>
      <div><dt>Material and depth resolution</dt><dd>A shallow lake may fall between contour levels and show no underwater step. Mountains can make each interval large. Automatic coverage adds the required depth sheets at the terrain’s vertical scale without reducing land relief. You can enable Limit depth layers and set an explicit allowance. Material thickness determines the smallest depth step.</dd></div>
      <div><dt>Fit lake depth to available layers</dt><dd>Off by default. With an explicit depth-layer limit, it compresses an over-deep lake to fit that allowance, keeping its waterline fixed and scaling depths uniformly; the studio shows the percentage of requested depth applied to each lake. Sea floors are not compressed. With fitting off and an explicit limit enabled, the deepest floor can be flattened, and the warning offers <strong>Fit depth</strong> to turn fitting on. <strong>Use manual depth</strong> turns it off again.</dd></div>
    </dl>
    <p><strong>If a lake looks flat:</strong> confirm that <strong>Water depth</strong> is on in layered mode, check the warnings, and try raising depth exaggeration. A shallow lake can show no underwater step at 1× and one or more at 4×, depending on the crop and material settings. Flat engraving does not generate the stacked lake-depth recess.</p>
    <p>Some lakes stay flat regardless of settings: lakes without a survey or a published maximum depth, water with no shoreline inside the map (zoom out to include one), and lakes too small to cut at your size and minimum feature setting.</p>
  </section>

  <section id="confidence" aria-labelledby="confidence-title">
    <h2 id="confidence-title">How to read the result</h2>
    <p>Exported project files record each lake’s depth source as one of these values:</p>
    <div class="reading-key">
      <p><strong>Surveyed:</strong> the floor uses survey coverage or underwater relief already present in the terrain data. Grids can themselves contain interpolation; this does not mean every displayed point was directly measured.</p>
      <p><strong>Modeled or user-adjusted:</strong> the floor is predicted, even if its maximum depth comes from a measurement or a value you entered.</p>
      <p><strong>Mixed:</strong> available survey samples are retained, with gaps filled from terrain or modeled depths where possible. A maximum depth you enter for a partly surveyed lake keeps it mixed.</p>
      <p><strong>Traced from your chart:</strong> the floor follows a depth chart you traced in the studio, recorded as a user source. Uncovered cells use existing terrain, modeled depths, or estimates near surveyed shores where possible; cells without enough information remain at the waterline.</p>
    </div>
    <p>The studio displays <strong>“Some lake depths are estimated rather than surveyed”</strong> when any lake in the output is not fully surveyed, and a separate warning for each lake with incomplete survey coverage. A lake carved from your own chart shows <strong>“Some lake floors come from a traced depth chart”</strong> instead: it is only as accurate as the chart and the depths you placed on it. Exported project metadata keeps depth provenance, applied depth fitting, and warnings. Source credits accompany the export.</p>
    <p>Nearby hills cannot reveal every submerged channel, sediment deposit, dam, or glacially carved hollow. Our terrain-based model has not been calibrated to promise a particular real-world accuracy. Even a surveyed floor is simplified and scaled for fabrication. Use the result as decorative terrain artwork, not a navigation or engineering depth map.</p>
    <div class="next-links"><a href={`${base}/guides/lake-depth-data`}>Find surveyed lakes →</a><a href={`${base}/studio`}>Try it in the studio →</a></div>
  </section>
</Article>

<style>
  section { scroll-margin-top: 24px; }
  .contents { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-block: 24px 36px; font-size: 14px; }
  .contents a { padding-block: 8px; }
  .source-types { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .source-types > div { padding: 20px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); }
  .source-types h3 { margin-top: 12px; }
  .source-types p { font-size: 14px; line-height: 1.7; margin-bottom: 0; }
  .eyebrow { font-size: 12px; color: var(--loidolt-text-muted); }
  details { margin-block: 24px; border-block: 1px solid var(--loidolt-border); padding-block: 4px; }
  summary { cursor: pointer; padding-block: 16px; font-weight: 600; line-height: 1.5; }
  summary:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 4px; }
  .provider-list { padding-left: 20px; }
  .provider-list span { display: block; font-size: 13px; color: var(--loidolt-text-muted); }
  .process { padding-left: 24px; }
  .process li { padding-left: 8px; margin-block: 20px; }
  .settings > div { padding-block: 18px; border-bottom: 1px solid var(--loidolt-border); }
  dt { font-weight: 600; margin-bottom: 8px; }
  dd { margin: 0; line-height: 1.8; }
  .reading-key { border-left: 3px solid var(--loidolt-accent); padding: 1px 20px; background: var(--loidolt-surface); }
  .next-links { display: flex; gap: 16px 24px; flex-wrap: wrap; margin-top: 28px; }
  .next-links a { min-height: 44px; display: inline-flex; align-items: center; font-weight: 600; }
  /* Wide layouts show the shared "On this page" list beside the article. */
  @media (min-width: 1240px) { .contents { display: none; } }
  @media (max-width: 650px) { .source-types { grid-template-columns: 1fr; } }
</style>
