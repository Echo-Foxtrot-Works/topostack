<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  import { lakeStudioLink } from "$lib/site/lake-directory";
  const base = basePath();

  let { data } = $props();
  const total = $derived(data.regions.reduce((sum, region) => sum + region.count, 0));
</script>

<Article title="Lake depth maps by region" intro={`TopoStack includes surveyed lake-floor data for ${total.toLocaleString("en-US")} lakes and basins. Pick a region, open a lake in the studio, and cut its depths as layers for a wooden lake map.`}>
  <p>Most topographic map tools show a lake as a flat hole. With a surveyed lake, TopoStack builds the lake floor from published depth measurements, so each layer of a stacked map follows the real drop-offs, bays and deep holes. That is what makes a lake map recognizable to the people who fish, sail or live on it.</p>

  <h2>Regions with surveyed lakes</h2>
  <ul class="regions">
    {#each data.regions as region (region.path)}
      <li>
        <h3><a href={`${base}${region.path}`}>{region.name}</a></h3>
        <p>{region.count.toLocaleString("en-US")} {region.count === 1 ? "lake" : "lakes"} · {region.kind} from {region.sources.join(", ")}.</p>
        {#if region.largest.length}<p class="meta">Largest survey areas: {#each region.largest as lake, index (lake.name)}{index ? ", " : ""}<a href={lake.page ? `${base}${lake.page}` : lakeStudioLink(base, lake)} data-sveltekit-reload>{lake.name}</a>{/each}</p>{/if}
      </li>
    {/each}
  </ul>

  <h2>Surveyed grids and survey contours</h2>
  <p>A <strong>surveyed grid</strong> is a continuous lake-floor model, usually from multibeam sonar, and gives the most detailed layers. <strong>Survey contours</strong> are measured depth lines; TopoStack fills the space between them, which works well at the scale of a laser-cut map. Where a survey covers only part of a lake, the studio uses terrain or modeled depths for the rest and says so. <a href={`${base}/guides/how-lake-depths-work`}>How lake depths work</a> has the details.</p>

  <h2>From lake to laser</h2>
  <p>Open any lake from a region page, generate terrain with water depth on, and export SVG cut panels. The <a href={`${base}/guides/custom-lake-depth-map`}>custom lake depth map guide</a> walks through framing, depth layers and finishing, and <a href={`${base}/guides/water-paint-templates`}>paint templates</a> help you color only the water. Looking for a specific lake? <a href={`${base}/guides/lake-depth-data`}>Search the full directory</a> by name, county or survey ID, or see the worked <a href={`${base}/examples/crater-lake`}>Crater Lake example</a>.</p>
</Article>

<style>
  .regions { list-style: none; padding: 0; display: grid; gap: 4px; }
  .regions li { padding-block: 12px; border-bottom: 1px solid var(--loidolt-border); }
  .regions h3 { margin: 0 0 4px; font-size: 20px; }
  .regions p { margin: 4px 0; }
  .meta { color: var(--loidolt-text-muted); font-size: 14px; }
</style>
