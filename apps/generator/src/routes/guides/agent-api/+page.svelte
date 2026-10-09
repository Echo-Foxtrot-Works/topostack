<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";

  const origin = "https://topostack.app";
  const request = JSON.stringify({
    requestVersion: 1,
    area: { center: { lat: 39.09, lon: -120.04 }, widthKm: 30 },
    placeLabel: "Lake Tahoe, California and Nevada",
    output: "layered",
    widthMm: 400,
    heightMm: 300,
    materialThicknessMm: 3,
    verticalExaggeration: 2,
    details: { roads: false, boundaries: true },
    title: "LAKE TAHOE\n39.09° N 120.04° W",
    laser: { kerfMm: 0.15, workAreaWidthMm: 400, workAreaHeightMm: 400 },
    markers: [{ lat: 38.9533, lon: -119.9442, name: "South Lake Tahoe", symbol: "star" }],
  }, null, 2);
  const plan = `curl -s -X POST ${origin}/v1/projects/plan \\
  -H 'content-type: application/json' \\
  -d '{"requestVersion":1,"area":{"center":{"lat":46.8523,"lon":-121.7603},"widthKm":20},"placeLabel":"Mount Rainier"}'`;
  const linkFromProject = `curl -s -X POST ${origin}/v1/projects/link \\
  -H 'content-type: application/json' \\
  -d @- <<'EOF'
{ "project": <the project from a saved TopoStack project file> }
EOF`;
  const invalid = JSON.stringify({ error: "The project request is invalid.", errors: [{ path: "materialThicknessMm", message: "Must be between 0.5 and 25." }] }, null, 2);
</script>

<Article title="Project request and HTTP API reference" intro="The model request every TopoStack agent tool accepts, the studio links it becomes, and the HTTP routes that let a script plan models without an MCP client.">
  <p>The <a href={`${base}/guides/mcp-server`}>MCP server</a> and the HTTP API run the same code. A request means the same thing on either one, and both return the same plans and links. Neither generates files: a response ends in a studio link, and the model is generated and exported in the browser that opens it.</p>

  <h2>The project request</h2>
  <p>A request describes the model in physical terms. Only <code>requestVersion</code> and <code>area</code> are required. Every other field falls back to the studio's default, and unknown fields are rejected. The MCP tools assume <code>requestVersion: 1</code> when it is left out; the HTTP routes require it. The JSON Schema is embedded in the OpenAPI document and is also served as the MCP resource <code>topostack://schema/project-request-v1</code>.</p>
  <pre><code>{request}</code></pre>

  <table class="fields">
    <thead><tr><th scope="col">Field</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td><code>requestVersion</code></td><td><code>1</code></td><td></td><td>Required on HTTP routes</td></tr>
      <tr><td><code>area</code></td><td><code>{"{ center: { lat, lon }, widthKm }"}</code> or <code>{"{ bounds: { west, south, east, north } }"}</code></td><td></td><td>See the notes below.</td></tr>
      <tr><td><code>placeLabel</code></td><td>Up to 240 characters</td><td>Custom coordinates</td><td>Shown in the studio, for example a label from place search</td></tr>
      <tr><td><code>name</code></td><td>Up to 120 characters</td><td>The part of <code>placeLabel</code> before the first comma</td><td>Also names the exported files</td></tr>
      <tr><td><code>output</code></td><td><code>layered</code>, <code>flat</code></td><td><code>layered</code></td><td>A stack of cut sheets, or contour lines engraved on one sheet</td></tr>
      <tr><td><code>widthMm</code>, <code>heightMm</code></td><td>20–10,000</td><td>300 × 200</td><td>The finished model</td></tr>
      <tr><td><code>shape</code></td><td><code>rectangle</code>, <code>circle</code></td><td><code>rectangle</code></td><td></td></tr>
      <tr><td><code>units</code></td><td><code>metric</code>, <code>imperial</code></td><td><code>metric</code></td><td>For engraved labels and the scale bar; files are always in millimeters</td></tr>
      <tr><td><code>materialThicknessMm</code></td><td>0.5–25</td><td>3</td><td>Layered. Thicker material gives fewer, coarser layers.</td></tr>
      <tr><td><code>verticalExaggeration</code></td><td>1–10</td><td>2</td><td>Layered. It is refitted so the stack is a whole number of sheets.</td></tr>
      <tr><td><code>contourCount</code></td><td>Whole number, 4–40</td><td>12</td><td>Flat. Engraved contour lines across the elevation range.</td></tr>
      <tr><td><code>details</code></td><td><code>water</code>, <code>waterDepth</code>, <code>roads</code>, <code>trails</code>, <code>roadLabels</code>, <code>boundaries</code>, <code>coordinateGrid</code>, <code>elevationLabels</code>, <code>northArrow</code>, <code>scaleBar</code> (true or false)</td><td>On: water, water depth, roads, trails, elevation labels, north arrow, scale bar. Off: road labels, boundaries, coordinate grid.</td><td>Keys left out keep their default</td></tr>
      <tr><td><code>aviation</code></td><td><code>airspace</code>, <code>specialUse</code>, <code>runways</code>, <code>airports</code>, <code>navaids</code>, <code>obstacles</code>, <code>labels</code> (true or false)</td><td>All off</td><td>FAA detail engraved like a VFR sectional's, in the United States and its territories. Decorative, never for navigation. Turning every switch off removes it.</td></tr>
      <tr><td><code>airspaceStack</code></td><td><code>false</code>, or <code>{"{ form?, classes?, ceilingCapFt?, thicknessMm?, kerfMm?, rod? }"}</code></td><td>Off</td><td>Layered, United States only. Builds Class B, C and special use airspace over the model in acrylic, at true height, on rods cut to length. <code>form</code>: <code>plates</code> (default), <code>tiers</code>, <code>volumes</code>. <code>classes</code>: <code>B</code>, <code>C</code>, <code>specialUse</code> (on by default) and <code>D</code> (a flat lid over each tower airport, off). <code>ceilingCapFt</code>: 1,000–60,000; by default the highest Class B or C ceiling in the area. <code>thicknessMm</code> 1–10 and <code>kerfMm</code> 0–1 default to the wood's. <code>rod</code>: <code>shape</code> <code>round</code> or <code>square</code>, <code>sizeMm</code> 2–12 (4), <code>fitClearanceMm</code> 0–0.5 (0.1), <code>socketDepthMm</code> 1–30 (6), <code>joint</code> <code>segments</code> (default) or <code>through</code>. On a design that already has it, only the fields given change; <code>false</code> or every class off removes it. A whole Class B separates into its shelves near 10× exaggeration. Decorative, never for navigation.</td></tr>
      <tr><td><code>title</code></td><td>Up to 3 lines of 40 characters, separated by <code>\n</code></td><td>None</td><td>An empty string removes the title</td></tr>
      <tr><td><code>laser.kerfMm</code></td><td>0–1</td><td>0.15</td><td>Kerf compensation for the cut lines</td></tr>
      <tr><td><code>laser.workAreaWidthMm</code>, <code>laser.workAreaHeightMm</code></td><td>0, or 20–10,000</td><td>0 (unlimited)</td><td>A model larger than the bed is split into pieces with alignment tabs</td></tr>
      <tr><td><code>markers</code></td><td>Up to 20 of <code>{"{ lat, lon, name?, symbol? }"}</code></td><td>None</td><td>Names up to 60 characters. Symbols: <code>pin</code> (default), <code>circle</code>, <code>triangle</code>, <code>star</code>, <code>cross</code>.</td></tr>
    </tbody>
  </table>
  <p>Notes on the area:</p>
  <ul>
    <li><code>widthKm</code> is the ground distance from west to east, from 0.1 to 2,000 km.</li>
    <li>With <code>bounds</code>, the whole box stays in view, and the crop is fitted to the model's proportions.</li>
    <li>Latitudes must lie within ±85.0511°, the limit of Web Mercator.</li>
    <li>A box can cross the antimeridian: give west greater than east, as GeoJSON does (for Fiji, <code>west: 177</code>, <code>east: -178</code>).</li>
  </ul>
  <p>Notes on text fields:</p>
  <ul>
    <li>Control characters, and invisible characters such as zero-width or bidirectional marks, are removed.</li>
    <li>Runs of whitespace are collapsed.</li>
  </ul>
  <p>Fonts, line styles, custom graphics, GPS tracks and depth charts are not part of the request. The person sets them in the studio after opening the link. For what each setting does, see the <a href={`${base}/guides/settings-reference`}>studio settings reference</a>.</p>

  <h2>Studio links</h2>
  <p>A studio link has the form <code>https://topostack.app/studio?generate=1#p=1.&lt;design&gt;</code>. The whole design is compressed into the part after <code>#</code>, which browsers never send to a server. Opening the link does three things:</p>
  <ul>
    <li>It loads the design as one undoable change, so Undo brings back the project that was open before.</li>
    <li>It starts generating straight away.</li>
    <li>It removes the design from the address bar, so a refresh does not generate again.</li>
  </ul>
  <p>The same request always gives the same link. Links are limited to 8,000 characters. A request normally fits easily; a complete project with a lot of custom data may not, and is then refused with a message saying so.</p>

  <h2>HTTP routes</h2>
  <p>The OpenAPI 3.1 document at <code>{origin}/v1/openapi.json</code> describes every route. POST bodies are JSON (<code>content-type: application/json</code>) of at most 128,000 bytes.</p>
  <table class="routes">
    <thead><tr><th scope="col">Route</th><th scope="col">Takes</th><th scope="col">Returns</th></tr></thead>
    <tbody>
      <tr><td><code>POST /v1/projects/resolve</code></td><td>A project request</td><td>The complete studio project the request expands to, its <code>studioUrl</code>, and attribution</td></tr>
      <tr><td><code>POST /v1/projects/plan</code></td><td>A project request</td><td>The same plan as the <code>plan_model</code> tool: the project summary, the sheet count, the stack height, fitted exaggeration, scale, elevation range, coverage, notes, <code>studioUrl</code> and attribution</td></tr>
      <tr><td><code>POST /v1/projects/link</code></td><td>A project request, or <code>{"{ \"project\": … }"}</code> holding a complete studio project</td><td><code>url</code> and <code>length</code></td></tr>
      <tr><td><code>GET /v1/coverage</code></td><td><code>?bbox=west,south,east,north</code> or <code>?lat=…&amp;lon=…&amp;widthKm=…</code></td><td>High-resolution terrain and lake surveys covering the area, with attribution</td></tr>
      <tr><td><code>GET /v1/geocode</code></td><td><code>?q=</code> (2–160 characters) and optional <code>limit</code> (1–8)</td><td>Place search results</td></tr>
      <tr><td><code>GET /v1/openapi.json</code></td><td></td><td>The OpenAPI document</td></tr>
    </tbody>
  </table>
  <p>For example, to plan a model:</p>
  <pre><code>{plan}</code></pre>
  <p>To make a link for a project saved from the studio, rather than for a request:</p>
  <pre><code>{linkFromProject}</code></pre>

  <h2>Errors</h2>
  <p>Errors are JSON with an <code>error</code> message. A <code>422</code> for a request also lists each invalid field:</p>
  <pre><code>{invalid}</code></pre>
  <table>
    <thead><tr><th scope="col">Status</th><th scope="col">When</th></tr></thead>
    <tbody>
      <tr><td><code>400</code></td><td>The body is not valid JSON, or the coverage query is malformed</td></tr>
      <tr><td><code>405</code></td><td>The wrong method for the route</td></tr>
      <tr><td><code>413</code></td><td>The body is over 128,000 bytes, or the design does not fit in an 8,000-character link</td></tr>
      <tr><td><code>415</code></td><td>The body is not sent as <code>application/json</code></td></tr>
      <tr><td><code>422</code></td><td>The request or project is invalid</td></tr>
      <tr><td><code>429</code></td><td>A rate limit, below. Retry after the <code>retry-after</code> seconds. On a plan, "The terrain budget for this client is used up" means the terrain tiles, not the request budget, ran out.</td></tr>
      <tr><td><code>502</code></td><td>Terrain could not be fetched for a plan, or place search failed. Try again shortly.</td></tr>
      <tr><td><code>503</code>, <code>504</code></td><td>Place search is not configured on this server, or timed out.</td></tr>
    </tbody>
  </table>

  <h2>Limits</h2>
  <ul>
    <li>No key or account is needed.</li>
    <li>The POST routes share a budget with the MCP server: 120 requests a minute per address, and a shared ceiling of 1,200 a minute.</li>
    <li>A plan reads at most four low-resolution terrain tiles. When those are not cached, they also count against the terrain budget.</li>
    <li>Place search has its own budget of 30 uncached searches a minute per address.</li>
    <li>Responses allow any origin, so browser code on another site can call the API.</li>
  </ul>

  <h2>How accurate a plan is</h2>
  <p>A plan samples coarse terrain, which smooths sharp peaks. Lake depth can also add sheets that only full generation counts. Measured against the studio, plans agree within a sheet or two, for example:</p>
  <ul>
    <li>Mount Rainier: 35 planned, 36 generated;</li>
    <li>Lake Tahoe: 9 and 9;</li>
    <li>the Matterhorn: 45 and 45.</li>
  </ul>
  <p>The count the studio shows after generating is the one that is cut. Output is decorative, not survey-grade.</p>
  <p>A plan's <code>notes</code> are plain sentences worth showing to the person. The first always says the count is an estimate. Others appear when the ground is nearly flat, when a layered stack passes 60 sheets, when the area reaches the sea (the sea is cut flat and the stack is sized from the land), when surveyed lake depth will add sheets below the shoreline, when the model is larger than the laser bed, so each sheet is split into pieces with alignment tabs, and when aviation detail or airspace is asked for (the FAA cycle, or that the area has no FAA data). With <code>airspaceStack</code>, the plan's <code>airspace</code> estimates the height of the acrylic at the ceiling cap, and notes say when it passes 250 mm, when the exaggeration is below 10× so some levels merge, and that the studio places the rods and lists their lengths when it generates the model.</p>

  <h2>Data and credit</h2>
  <p>Every plan, link and coverage response includes an <code>attribution</code> object for the terrain, map and lake data it used. Keep its credit line with anything shown or passed on. The full list of sources and licenses is on the <a href={`${base}/attribution`}>attribution page</a>, and the <a href={`${base}/privacy`}>privacy notice</a> covers what the API receives.</p>
</Article>

<style>
  /* On a phone each row becomes a block, labelled where the column heading is hidden, as in the settings reference. */
  @media (max-width: 700px) {
    table, tbody, tr, td { display: block; }
    thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    tr { padding-block: 10px; border-bottom: 1px solid var(--loidolt-border); }
    td { padding: 2px 0; border: 0; }
    td:first-child { font-weight: 600; }
    td:empty { display: none; }
    td code { overflow-wrap: anywhere; }
    .fields td:nth-child(2)::before { content: "Range: "; color: var(--loidolt-text-muted); font-weight: 400; }
    .fields td:nth-child(3)::before { content: "Default: "; color: var(--loidolt-text-muted); font-weight: 400; }
    .routes td:nth-child(2)::before { content: "Takes: "; color: var(--loidolt-text-muted); font-weight: 400; }
    .routes td:nth-child(3)::before { content: "Returns: "; color: var(--loidolt-text-muted); font-weight: 400; }
  }
</style>
