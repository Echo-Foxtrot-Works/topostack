<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
  import { FONT_CATALOG } from "@topostack/core";
  import { REPOSITORY_URL } from "$lib/site/seo";
  import { MAP_DATA_ATTRIBUTION } from "$lib/domain/map-attribution";
  import { sources as terrainCatalogSources } from "../../../../../scripts/data/terrain-sources.json";
  import aviationSources from "../../../../../scripts/data/faa-aviation-sources.json";
  import type { PageData } from "./$types";

  let { data }: { data: PageData } = $props();

  const uses: Record<string, { section: string; description: string }> = {
    "Mapzen Terrain Tiles": { section: "terrain", description: "Elevation tiles are sampled, cropped to your selected area, and converted into terrain layers, contour lines, and 3D previews. Vertical exaggeration and contour spacing are applied by TopoStack." },
    "HydroLAKES v1.0": { section: "lakes", description: "Lake outlines, identifiers, surface elevations, and estimated average depths supplement provider water masks and OSM shorelines to locate lakes and connect them to depth data. TopoStack clips and simplifies the outlines and joins them to GLOBathy estimates and available surveys." },
    "GLOBathy": { section: "lakes", description: "Maximum depths, from reported measurements where available and model estimates elsewhere, help TopoStack construct a modeled lake floor where survey coverage is unavailable. The resulting shape is a TopoStack approximation, not a measured bathymetric survey." },
    "Protomaps Basemap 20260905": { section: "features", description: "The pinned OpenStreetMap-derived basemap supplies roads, trails, water features, and boundaries for generated artwork. TopoStack selects, classifies, clips, and simplifies these features into engraving paths." },
    "OpenStreetMap contributors": { section: "features", description: "Community mapping supplies the underlying geographic features used through Protomaps, the location map, and place search. Map data © OpenStreetMap contributors." },
  };
  const terrainContributors = MAP_DATA_ATTRIBUTION.filter((source) => !uses[source.name]);
  // Several catalog entries can come from one published dataset; credit each once.
  const terrainSources = terrainCatalogSources.filter((source, index, all) => all.findIndex((other) => other.name === source.name && other.license === source.license) === index);
  const sections = [
    { id: "terrain", title: "Terrain and elevation" },
    { id: "features", title: "Roads, trails, water, and boundaries" },
    { id: "lakes", title: "Lake outlines and modeled depth" },
  ];
  const surveyNotes: Record<string, string> = {
    "noaa-great-lakes-v1": "Great Lakes depth grids are sampled relative to each lake’s published low-water datum. Lake Superior remains a draft dataset.",
    "usgs-crater-lake-v1": "The 2000 multibeam survey supplies Crater Lake’s floor. Published bed elevations are converted to depths using a reference water level of 1,882.6 m.",
    "usgs-lake-tahoe-v1": "The 1998 multibeam survey supplies Lake Tahoe’s floor. Published bed elevations are converted to depths using the survey’s 1,899 m reference level.",
    "usgs-mono-lake-v1": "The bathymetric model based on the 1986–87 survey supplies Mono Lake’s floor. Elevations in feet are converted to depths in meters using a 6,390 ft reference level.",
    "swissbathy3d-v1": "Swiss lake-floor grids are averaged to a 10 m serving grid and aligned approximately to HydroLAKES surface elevations. Coverage varies by lake; TopoStack does not perform a vertical-datum transformation.",
    "mn-dnr-lakes-v1": "Measured depth contours are converted from feet to meters and interpolated onto a 20 m grid, clipped to the published lake outlines and islands.",
    "syke-finland-lakes-v1": "Measured depth contours are interpolated onto a 20 m grid within the survey’s depth-area mask and measured contour coverage. Gaps remain unmeasured.",
    "ontario-lakes-v1": "Negative metre contours from the latest indexed survey are converted to positive depths and interpolated onto a masked 20 m grid within measured contour coverage.",
    "nve-norway-lakes-v1": "Digital depth contours are joined to survey polygons and interpolated onto a masked 20 m grid for the covered Norwegian lakes.",
    "twdb-texas-reservoirs-v1": "Verified contours for Alan Henry, Lake Austin, and Lady Bird Lake are converted using report reference levels and interpolated onto masked 10 m grids.",
    "usbr-reservoirs-v1": "Verified surveys of Estes, Flatiron, and Pinewood use documented historical reference levels and conservative contour masks to produce 10 m depth grids.",
    ...Object.fromEntries(["florida", "gulf-coast", "atlantic-coast", "great-lakes-basin", "california", "northwest-coast", "inland-northwest", "alaska", "caribbean"].map((region) => [
      `noaa-nbs-${region}-v1`,
      "Only cells from measured, openly licensed surveys are kept; NOAA’s modelled fill and restricted sources are removed. Depths below the surveys’ chart datum are averaged to an 8 m grid and clipped to each HydroLAKES outline. Lakes whose surveyed bed lies mostly above that datum are left out.",
    ])),
    ...Object.fromEntries(["florida", "gulf-coast", "atlantic-coast", "great-lakes-basin", "new-york-vermont", "california", "columbia-river", "alaska"].map((region) => [
      `noaa-enc-${region}-v1`,
      "Depth contours and soundings from NOAA electronic navigational charts, most detailed chart first, are interpolated onto a 20 m grid inside each HydroLAKES outline with the shoreline at 0 m. Chart depths are generalized for navigation and refer to the chart’s low-water or sounding datum. Lakes charted mostly as drying, and Lake Mead, whose soundings refer to a fixed pool elevation, are left out.",
    ])),
  };
  const software = [
    { name: "Svelte and SvelteKit", url: "https://github.com/sveltejs", license: "MIT", use: "Application interface, routing, and static pages." },
    { name: "Loidolt Theme", url: "https://github.com/loidolt/loidolt-theme", license: "MIT", use: "Shared interface components, styles, and themes." },
    { name: "Lucide", url: "https://lucide.dev/license", license: "ISC", use: "Interface icons." },
    { name: "MapLibre GL JS", url: "https://github.com/maplibre/maplibre-gl-js", license: "BSD-3-Clause", use: "Interactive location map rendering." },
    { name: "Three.js", url: "https://github.com/mrdoob/three.js", license: "MIT", use: "3D terrain and exploded layer previews." },
    { name: "PMTiles", url: "https://github.com/protomaps/PMTiles", license: "BSD-3-Clause", use: "Reading map, terrain, and bathymetry tile archives." },
    { name: "@mapbox/vector-tile and pbf", url: "https://github.com/mapbox/vector-tile-js", license: "BSD-3-Clause", use: "Decoding vector map tiles and their Protocol Buffer data." },
    { name: "d3-contour", url: "https://github.com/d3/d3-contour", license: "ISC", use: "Tracing contour lines from elevation grids." },
    { name: "clipper-lib", url: "https://github.com/junmer/clipper-lib", license: "BSL-1.0", use: "Offsetting cut paths for kerf compensation and clearances around map markers." },
    { name: "polygon-clipping", url: "https://github.com/mfogel/polygon-clipping", license: "MIT", use: "Combining and clipping terrain and map geometry." },
    { name: "sparrow", url: "https://github.com/JeroenGar/sparrow", license: "MIT, © 2025 Jeroen Gardeyn, KU Leuven", use: "Nesting pieces onto stock sheets, compiled to WebAssembly and run in your browser. Gardeyn, Vanden Berghe and Wauters, “An open-source heuristic to reboot 2D nesting research” (arXiv:2509.13329)." },
    { name: "jagua-rs", url: "https://github.com/JeroenGar/jagua-rs", license: "MPL-2.0 (unmodified; source at crates.io/crates/jagua-rs/0.8.3)", use: "Collision detection behind sparrow's nesting. Gardeyn, Vanden Berghe and Wauters, INFORMS Journal on Computing, doi:10.1287/ijoc.2024.1025. Full licence texts for the nesting engine: /licenses/third-party.txt." },
    { name: "fflate", url: "https://github.com/101arrowz/fflate", license: "MIT", use: "Decompressing terrain tiles and creating downloadable project ZIP files." },
    { name: "idb-keyval", url: "https://github.com/jakearchibald/idb-keyval", license: "Apache-2.0", use: "Saving project settings in your browser." },
  ];
</script>

<Article title="Sources and attribution" intro="TopoStack is built on shared geographic data and open-source work. Here is where that work comes from, how we use it, and who to credit.">
  <nav class="contents" aria-label="On this page">
    <span>On this page</span>
    <a href="#terrain">Terrain</a><a href="#features">Map features</a><a href="#lakes">Lake models</a><a href="#surveys">Lake surveys</a><a href="#aviation">Aviation</a><a href="#services">Map and search</a><a href="#artwork">Artwork</a><a href="#software">Software</a><a href="#exports">Export credits</a>
  </nav>

  {#each sections as section}
    <section id={section.id} aria-labelledby={`${section.id}-title`}>
      <h2 id={`${section.id}-title`}>{section.title}</h2>
      {#each MAP_DATA_ATTRIBUTION.filter((source) => uses[source.name]?.section === section.id) as source}
        <div class="source">
          <h3><a href={source.url}>{source.name}</a></h3>
          <p>{uses[source.name]?.description}</p>
          <p class="credit"><strong>Credit / license:</strong> {source.license}</p>
        </div>
      {/each}
      {#if section.id === "terrain"}
        {#each terrainSources as source}
          <div class="source">
            <h3><a href={source.url}>{source.name}</a></h3>
            <p>Within registered coverage, preferred bare-earth elevations are selected by quality priority, native resolution, and survey year. Standard terrain fills coverage gaps. These elevations describe the ground and water surface; lake-floor depths use separate sources.</p>
            <p class="credit"><strong>Credit / license:</strong> {source.license}</p>
          </div>
        {/each}
        <p>Mapzen combines regional and global elevation datasets. Contributors vary with the selected location; the credits below cover its contributing sources. See the <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">terrain source attribution and terms</a>.</p>
        <details>
          <summary>Terrain contributors and credit notices ({terrainContributors.length})</summary>
          <ul class="contributors">{#each terrainContributors as source}<li><a href={source.url}>{source.name}</a><p class="credit">{source.license}</p></li>{/each}</ul>
        </details>
      {:else if section.id === "features"}
        <p>OpenStreetMap data is available under the <a href="https://opendatacommons.org/licenses/odbl/1-0/">Open Database License (ODbL) 1.0</a>. See <a href="https://www.openstreetmap.org/copyright">OpenStreetMap’s copyright and attribution guidance</a> and <a href="https://github.com/protomaps/basemaps/blob/main/LICENSE_DATA.md">Protomaps licensing</a>.</p>
        <p>Protomaps’ source pipeline also includes <a href="https://osmdata.openstreetmap.de/">OSM water and earth polygons</a>, produced by Jochen Topf and osmcoastline contributors under ODbL, and <a href="https://www.naturalearthdata.com/about/terms-of-use/">Natural Earth</a> public-domain geographic data by Tom Patterson, Nathaniel Vaughn Kelso, and contributors. These provide coastline and generalized geographic context where included in the selected tiles.</p>
      {:else if section.id === "lakes"}
        <p>HydroLAKES is licensed under <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>. Research citation: Messager et al. (2016), <a href="https://doi.org/10.1038/ncomms13603">Estimating the volume and age of water stored in global lakes using a geo-statistical approach</a>.</p>
        <p>GLOBathy data is released under <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>. Research citation: Khazaei et al. (2022), <a href="https://doi.org/10.1038/s41597-022-01132-9">GLOBathy, the global lakes bathymetry dataset</a>.</p>
      {/if}
    </section>
  {/each}

  <section id="aviation" aria-labelledby="aviation-title">
    <h2 id="aviation-title">Aviation</h2>
    <div class="source">
      <h3><a href={aviationSources.url}>FAA Aeronautical Information Services</a></h3>
      <p>When aviation detail is turned on for an area in the United States or its territories, Class B, C and D airspace, airports, runways and navaids come from the FAA's 28-day NASR subscription (cycle effective {aviationSources.nasrCycle}). Obstacles come from the Digital Obstacle File ({aviationSources.obstacleDate}), and special use airspace from the FAA's published service ({aviationSources.suaDate}). TopoStack draws airspace and runways as lines and airports, navaids and obstacles as simplified symbols. It clips them to your area and leaves out Class E airspace and private helipads.</p>
      <p><strong>Not for navigation.</strong> Aeronautical data is replaced every 28 days, and an engraving is never updated. Use current FAA charts for flight planning.</p>
      <p class="credit"><strong>Credit / license:</strong> {aviationSources.license}</p>
    </div>
  </section>

  <section id="surveys" aria-labelledby="surveys-title">
    <h2 id="surveys-title">Surveyed lake depth</h2>
    <p>Where coverage is available and water depth is enabled, TopoStack uses published lake-floor grids or interpolates measured depth contours. Survey gaps may use existing terrain or modeled depths. Your depth scale and layer settings can further alter the shape for fabrication.</p>
    <p><a href={`${base}/guides/lake-depth-data`}>Find a lake in the depth directory</a>. Catalog updated {data.updated}.</p>
    <p><a href={`${base}/guides/how-lake-depths-work`}>How we turn surveys and terrain into lake depths</a> explains the process, predictions, and fabrication limits.</p>
    {#each data.surveySources as source}
      <div class="source">
        <h3><a href={source.url}>{source.name}</a></h3>
        <p class="meta">{source.region} · {source.kind === "contours" ? "Survey contours" : "Surveyed grid"}</p>
        <p>{surveyNotes[source.id] ?? "Published bathymetry is sampled within its available coverage to shape lake depth in terrain projects."}</p>
        <p class="credit"><strong>Credit / license:</strong> {#each source.license.split(/(https:\/\/\S+)/) as part}{#if part.startsWith("https://")}<a href={part}>Source terms</a>{:else}{part}{/if}{/each}</p>
        {#if source.id === "noaa-great-lakes-v1"}
          <p class="credit">Dataset citations: {#each data.noaaCitations as citation, i}{i ? " · " : ""}<a href={citation.url}>{citation.name}</a>{/each}.</p>
        {/if}
      </div>
    {/each}
  </section>

  <section id="services" aria-labelledby="services-title">
    <h2 id="services-title">Location map and place search</h2>
    <div class="source">
      <h3><a href="https://openfreemap.org/">OpenFreeMap</a> and <a href="https://openmaptiles.org/">OpenMapTiles</a></h3>
      <p>The studio’s location map uses OpenFreeMap’s Liberty style and hosted tiles to help you frame an area. Generated artwork uses the terrain and feature datasets described above.</p>
      <p class="credit">OpenFreeMap · © OpenMapTiles · Data from <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>. <a href="https://openfreemap.org/quick_start/">Provider credits</a> remain available on the interactive map.</p>
    </div>
    <div class="source">
      <h3><a href="https://www.naturalearthdata.com/">Natural Earth</a></h3>
      <p>The small maps on individual lake pages that show where each lake is use Natural Earth’s 1:50m land, lakes, country borders and state or province lines, simplified for the page.</p>
      <p class="credit">Made with Natural Earth. Free vector and raster map data @ naturalearthdata.com. Public domain.</p>
    </div>
    <div class="source">
      <h3><a href="https://www.geoapify.com/">Geoapify</a></h3>
      <p>Place search turns a place name into coordinates and a location label so you can select an area. Search is powered by Geoapify and includes OpenStreetMap-derived information.</p>
      <p class="credit">Powered by Geoapify · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>. <a href="https://www.geoapify.com/terms-and-conditions/">Service terms</a>.</p>
    </div>
  </section>

  <section id="artwork" aria-labelledby="artwork-title">
    <h2 id="artwork-title">Compass artwork, fonts and interface design</h2>
    <p>TopoStack’s north-arrow presets are redrawn as single-line engraving geometry, informed by these Wikimedia Commons references:</p>
    <ul>
      <li><a href="https://commons.wikimedia.org/wiki/File:Compass_rose_simple_plain.svg">Compass rose simple plain</a> — Henrik and Thryduulf; public domain as marked on the source page.</li>
      <li><a href="https://commons.wikimedia.org/wiki/File:CC0_Compass_Rose.svg">CC0 Compass Rose</a> — Kertase; <a href="https://creativecommons.org/publicdomain/zero/1.0/">CC0 1.0</a>.</li>
    </ul>
    <p>The interface uses <a href="https://github.com/indestructible-type/Jost">Jost</a> (Copyright 2020 The Jost Project Authors) and <a href="https://github.com/Omnibus-Type/Archivo">Archivo</a> (Copyright 2020 The Archivo Project Authors), bundled with Loidolt Theme. Both fonts use the <a href="https://openfontlicense.org/">SIL Open Font License 1.1</a>.</p>
    <p id="fonts">The engraving fonts other than the built-in styles are converted into TopoStack’s glyph format and engraved as paths. Each font’s licence and source file are kept in the <a href={`${REPOSITORY_URL}/tree/main/assets/fonts`}>repository</a>.</p>
    <ul>
      {#each FONT_CATALOG.filter((entry) => entry.kind !== "bitmap") as entry (entry.id)}<li><a href={`${REPOSITORY_URL}/tree/main/assets/fonts/${entry.id}`}>{entry.name}</a> — {entry.credit}.</li>{/each}
    </ul>
    <p>The Hershey Fonts were originally created by Dr. A. V. Hershey while working at the U. S. National Bureau of Standards. The format of the font data in this distribution was originally created by James Hurt, Cognition, Inc.</p>
    <p>Terrain illustrations are TopoStack’s own vector artwork. Studio screenshots show the bundled terrain preview. The Atomm interface adapts the <a href="https://dev.atomm.com/templates/layout-3-generate.skeleton.html">Atomm generator layout</a> and <a href="https://dev.atomm.com/design.md">design guidance</a>; its platform SDK provides the host integration.</p>
  </section>

  <section id="software" aria-labelledby="software-title">
    <h2 id="software-title">Open-source software</h2>
    <p>These libraries power the interface, map processing, previews, and downloads. Their maintainers and contributors retain their respective copyrights.</p>
    <ul class="contributors">{#each software as library}<li><a href={library.url}>{library.name}</a> <span class="meta">· {library.license}</span><p>{library.use}</p></li>{/each}</ul>
    <p>The <a href={`${REPOSITORY_URL}/blob/main/package-lock.json`}>complete dependency inventory</a> records direct and transitive packages. Each package’s license contains its full notices and terms. <a href={`${REPOSITORY_URL}/blob/main/LICENSE`}>TopoStack’s code license</a> applies to TopoStack code; geographic data and third-party assets retain their own terms.</p>
  </section>

  <section id="exports" aria-labelledby="exports-title">
    <h2 id="exports-title">Credits in your exported project</h2>
    <p>Complete project downloads for layered and flat output, and panel ZIP downloads, include <strong>ATTRIBUTION.txt</strong>. It lists the map-source notices, the high-resolution terrain, lake outline, and survey sources used, and the terrain imagery sources reported by the provider. Single-file downloads do not include it. The project manifest also records source attribution and dataset versions. Survey credits are added when survey data is used.</p>
    <p>Keep these files with the artwork when sharing a project. This page describes the sources available across TopoStack; your project’s records describe the data used for that generation.</p>
    <p class="note">TopoStack crops, resamples, simplifies, interpolates, and scales source data for decorative fabrication. These adaptations are made by TopoStack and do not imply endorsement by the original providers.</p>
    <p>Found a missing credit or an incorrect source description? <a href={`${REPOSITORY_URL}/issues`}>Report an attribution correction</a>.</p>
  </section>
</Article>

<style>
  .contents { display: flex; flex-wrap: wrap; gap: 10px 20px; padding: 20px; background: var(--loidolt-surface); border: 1px solid var(--loidolt-border); font-size: 14px; line-height: 1.8; }
  .contents span { flex-basis: 100%; font-weight: 600; }
  section { scroll-margin-top: 24px; }
  .source { padding-block: 4px 16px; border-bottom: 1px solid var(--loidolt-border); }
  .source p { margin-block: 10px; }
  .credit, .meta { color: var(--loidolt-text-muted); overflow-wrap: anywhere; }
  .source .credit, .source .meta { font-size: 14px; }
  .contributors { padding-left: 20px; }
  .contributors p { margin-block: 4px; }
  details { padding: 16px 20px; border: 1px solid var(--loidolt-border); background: var(--loidolt-surface); }
  summary { cursor: pointer; line-height: 1.6; font-weight: 600; }
  summary:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 4px; }
  @media print { details::details-content { content-visibility: visible; } }
  /* Wide layouts show the shared "On this page" list beside the article. */
  @media (min-width: 1240px) { .contents { display: none; } }
</style>
