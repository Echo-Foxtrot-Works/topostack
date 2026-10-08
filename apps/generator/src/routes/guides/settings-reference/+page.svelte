<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Studio settings reference" intro="Every control in the TopoStack studio, with its range, default and the output type it applies to.">
  <p>Lengths are listed in millimeters; the studio shows inches when <strong>Imperial</strong> is selected. <em>Layered</em> or <em>Flat</em> marks a control that appears for one output type only. Controls marked <em>Regenerate</em> need <strong>Regenerate terrain</strong> before export; all others update the preview on their own. For how to use them, see the <a href={`${base}/guides/studio-tour`}>studio tour</a>.</p>

  <h2>Project setup</h2>
  <table>
    <thead><tr><th scope="col">Control</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td>Project name</td><td>Up to 120 characters</td><td>Crater Lake</td><td>Also names exported files.</td></tr>
      <tr><td>Output type</td><td>Layered, Flat</td><td>Layered</td><td></td></tr>
      <tr><td>Location</td><td>Place search, coordinates, current location, surveyed lakes, example locations</td><td>Crater Lake, Oregon</td><td><em>Regenerate</em>. Choosing a surveyed lake also selects Layered and turns on Water depth.</td></tr>
      <tr><td>Map frame</td><td>Pan, zoom and drag handles on the Map preview; Lock aspect ratio</td><td></td><td><em>Regenerate</em> when the area changes.</td></tr>
    </tbody>
  </table>

  <h2>Cut size / Artwork size</h2>
  <table>
    <thead><tr><th scope="col">Control</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td>Units</td><td>Metric, Imperial</td><td>Metric</td><td>Display only. SVG files always use millimeters.</td></tr>
      <tr><td>Crop shape</td><td>Rectangle, Circle</td><td>Rectangle</td><td>A circle uses the width as its diameter.</td></tr>
      <tr><td>Width</td><td>Up to 10,000 mm</td><td>300 mm</td><td><em>Regenerate</em> if the aspect ratio changes.</td></tr>
      <tr><td>Height</td><td>Up to 10,000 mm</td><td>200 mm</td><td>Rectangle only. <em>Regenerate</em> if the aspect ratio changes.</td></tr>
    </tbody>
  </table>

  <h2>Terrain layers / Contour design</h2>
  <table>
    <thead><tr><th scope="col">Control</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td>Vertical exaggeration</td><td>1–10×, in 0.1 steps</td><td>2×</td><td><em>Layered</em>. Updates automatically and rounds to whole sheets, with a minimum of two and no upper layer cap. The studio shows the applied value.</td></tr>
      <tr><td>Material thickness</td><td>0.5–25 mm</td><td>3 mm</td><td><em>Layered</em>. With exaggeration, sets the layer count.</td></tr>
      <tr><td>Contour density</td><td>4–40 lines</td><td>12</td><td><em>Flat</em>. Lines across the elevation range.</td></tr>
      <tr><td>Index contour</td><td>Every 2–10 lines</td><td>5</td><td><em>Flat</em>. Every nth line is drawn heavier.</td></tr>
    </tbody>
  </table>

  <h2>Map details</h2>
  <table>
    <thead><tr><th scope="col">Control</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td>Roads</td><td>On, off</td><td>On</td><td></td></tr>
      <tr><td>Trails</td><td>On, off</td><td>On</td><td></td></tr>
      <tr><td>Transportation labels</td><td>On, off</td><td>Off</td><td>Road and trail names.</td></tr>
      <tr><td>Water outlines</td><td>On, off</td><td>On</td><td></td></tr>
      <tr><td>Water fill</td><td>None, Lines, Ripples, Dots</td><td>None</td><td><em>Flat</em>, with water outlines on.</td></tr>
      <tr><td>State / province boundaries</td><td>On, off</td><td>Off</td><td></td></tr>
      <tr><td>Latitude / longitude grid</td><td>On, off</td><td>Off</td><td></td></tr>
      <tr><td>Engraved border</td><td>On, off</td><td>On</td><td><em>Flat</em>.</td></tr>
      <tr><td>Water depth</td><td>On, off</td><td>On</td><td><em>Layered</em>. Carves lake and sea floors into the stack.</td></tr>
      <tr><td>Depth exaggeration</td><td>0.25–4×, in 0.05 steps</td><td>1×</td><td><em>Layered</em>, with water depth on. Relative to the terrain's vertical scale.</td></tr>
      <tr><td>Limit depth layers</td><td>On, off</td><td>Off (automatic)</td><td><em>Layered</em>. Automatic coverage adds depth sheets without compressing land relief.</td></tr>
      <tr><td>Maximum depth layers</td><td>Positive whole number</td><td>Current required depth sheets when enabled</td><td><em>Layered</em>. Explicit allowance below the lowest land; saved with the project.</td></tr>
      <tr><td>Fit lake depth to available layers</td><td>On, off</td><td>Off</td><td><em>Layered</em>. With an explicit depth-layer limit, compresses over-deep lakes into the allowance instead of flattening their floors.</td></tr>
      <tr><td>Maximum depth</td><td>Per lake, from 1 m</td><td>Published estimate</td><td><em>Layered</em>. Shown for modeled lakes with a depth estimate. Reset restores estimates.</td></tr>
      <tr><td>Assembly guides</td><td>On, off</td><td>On</td><td><em>Layered</em>. Alignment outlines and layer numbers.</td></tr>
      <tr><td>Elevation labels</td><td>On, off</td><td>On</td><td></td></tr>
      <tr><td>Label X, Label Y</td><td>−90 to 90%</td><td>−55%, 55%</td><td>Preferred position from the center.</td></tr>
      <tr><td>North arrow</td><td>On, off</td><td>On</td><td></td></tr>
      <tr><td>Compass design</td><td>Minimal, Classic, Mariner</td><td>Classic</td><td></td></tr>
      <tr><td>Diameter</td><td>12 mm to a limit set by the artwork size</td><td>24 mm</td><td></td></tr>
      <tr><td>Placement</td><td>Anywhere inside the material</td><td>Bottom right</td><td>Move on preview, then drag or use the arrow keys, and choose Done. The corner handle or + and − resize it there. Reset position returns to the default.</td></tr>
      <tr><td>Scale bar</td><td>On, off</td><td>On</td><td>Length follows the map scale.</td></tr>
      <tr><td>Scale bar placement</td><td>Anywhere inside the material</td><td>Near the top-left edge</td><td>Move on preview, like the north arrow.</td></tr>
      <tr><td>Title</td><td>On, off</td><td>Off</td><td>Up to 3 lines of 40 characters, engraved in capitals. Starts from the project name.</td></tr>
      <tr><td>Title letter height</td><td>3–30 mm</td><td>6 mm</td><td>Uses the Text engraving font.</td></tr>
      <tr><td>Title placement</td><td>Anywhere inside the material</td><td>Bottom left</td><td>Move on preview, like the north arrow. Lines align toward the nearest edge.</td></tr>
      <tr><td>Font</td><td>Technical, Rounded, Stencil</td><td>Technical</td><td>Under Text engraving.</td></tr>
      <tr><td>Text size</td><td>2–10 mm</td><td>3.1 mm</td><td>Capital-letter height.</td></tr>
    </tbody>
  </table>

  <h2>Custom Data</h2>
  <p>In the <strong>Custom data</strong> view. See <a href={`${base}/guides/custom-data`}>bring your own data</a> for how the sections fit together.</p>
  <table>
    <thead><tr><th scope="col">Control</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td>Markers</td><td>Up to 250; Pin, Circle, Triangle, Star, Cross</td><td>None</td><td>Latitude and longitude in decimal degrees; Size 1–200 mm (default 8 mm), shown in the selected units.</td></tr>
      <tr><td>Paths</td><td>Up to 250; Trail or Boundary; 2–2,000 points each, 10,000 in total</td><td>None</td><td>Engraved even when built-in trails or boundaries are off.</td></tr>
      <tr><td>Marker icons</td><td>Up to 24 SVGs, 1 MB each; Base or Center anchor</td><td>None</td><td>Simplified to 800 points each.</td></tr>
      <tr><td>Graphics</td><td>Up to 24 in the library, 50 placed; Engrave, Score or Cut; 3 mm up to the piece's shorter side</td><td>None</td><td>SVG up to 1 MB, simplified to 3,000 points. See <a href={`${base}/guides/custom-graphics`}>custom graphics</a>.</td></tr>
      <tr><td>Import</td><td>GPX, KML or GeoJSON, up to 20 MB</td><td>None</td><td>Adds markers, trails and boundaries in one undo step.</td></tr>
      <tr><td>Depth chart units</td><td>Feet, Metres, Fathoms</td><td>Feet</td><td><em>Layered</em>. PNG, JPEG, WebP or PDF. See <a href={`${base}/guides/trace-a-depth-chart`}>trace a depth chart</a>.</td></tr>
      <tr><td>The chart prints</td><td>Depth below the surface, Height above a datum</td><td>Depth below the surface</td><td><em>Layered</em>. Heights also need the water's surface level.</td></tr>
      <tr><td>Path type and interior</td><td>Outer shoreline, island boundary, or depth contour; deeper or shallower interior</td><td>Depth contour, deeper</td><td><em>Layered</em>. Assign each contour its printed value. An optional innermost bottom or summit value replaces the default flat interior; no uniform interval is required.</td></tr>
      <tr><td>Depth points</td><td>3 or more, on different contours</td><td>None</td><td><em>Layered</em>. Required for raster preparation; native PDF style selection can prepare without marks. Every included path still needs a confirmed value.</td></tr>
      <tr><td>Contour review</td><td>Confirm, correct, join, close, redraw, exclude; undo/redo</td><td>Unreviewed</td><td><em>Layered</em>. A source shoreline and valid closed, noncrossing depth contours are required.</td></tr>
      <tr><td>Chart alignment</td><td>4–64 distributed WGS84 control points</td><td>None</td><td><em>Layered</em>. Enter longitude/latitude and confirm the source overlay before generation.</td></tr>
      <tr><td>Layer review</td><td>Explicit confirmation</td><td>Unchecked</td><td><em>Layered</em>. Required to keep the generated chart. Edits invalidate approval.</td></tr>
    </tbody>
  </table>

  <h2>Linework</h2>
  <p>Presets: <strong>Fine</strong>, <strong>Balanced</strong> (default) and <strong>Bold</strong>. Widths below are the Balanced values; each ranges from 0.05 to 1.5 mm.</p>
  <table>
    <thead><tr><th scope="col">Control</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td>Minor contours</td><td>0.05–1.5 mm</td><td>0.16 mm</td><td><em>Flat</em>.</td></tr>
      <tr><td>Index contours</td><td>0.05–1.5 mm</td><td>0.32 mm</td><td><em>Flat</em>.</td></tr>
      <tr><td>Major roads</td><td>0.05–1.5 mm</td><td>0.38 mm</td><td></td></tr>
      <tr><td>Local roads</td><td>0.05–1.5 mm</td><td>0.26 mm</td><td></td></tr>
      <tr><td>Trails</td><td>0.05–1.5 mm</td><td>0.22 mm</td><td></td></tr>
      <tr><td>Water</td><td>0.05–1.5 mm</td><td>0.3 mm</td><td></td></tr>
      <tr><td>Boundaries</td><td>0.05–1.5 mm</td><td>0.24 mm</td><td></td></tr>
      <tr><td>Lat / long grid</td><td>0.05–1.5 mm</td><td>0.16 mm</td><td></td></tr>
      <tr><td>Road appearance</td><td>Centerline, Outlined</td><td>Centerline</td><td>Applies to major roads.</td></tr>
      <tr><td>Outline spacing</td><td>0.2–4 mm</td><td>0.8 mm</td><td>Outlined roads only.</td></tr>
      <tr><td>Road ends</td><td>Round, Square</td><td>Round</td><td></td></tr>
      <tr><td>Trail pattern</td><td>Solid, Dashed, Dotted</td><td>Dashed</td><td></td></tr>
      <tr><td>Labels &amp; guides</td><td>0.05–1.5 mm</td><td>0.2 mm</td><td>Text, north arrow, markers and assembly guides.</td></tr>
      <tr><td>Border</td><td>0.05–1.5 mm</td><td>0.34 mm</td><td><em>Flat</em>.</td></tr>
    </tbody>
  </table>

  <h2>Fabrication settings / Artwork settings</h2>
  <table>
    <thead><tr><th scope="col">Control</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td>Material-saving nests</td><td>On, off</td><td>On</td><td><em>Layered</em>. Cuts upper layers from covered parts of lower sheets.</td></tr>
      <tr><td>Water paint templates</td><td>On, off</td><td>Off</td><td><em>Layered</em>. Adds a paper stencil SVG beside each panel with visible water, cut to the piece outline with windows over the water that stays visible after assembly, so you can spray paint it without colouring the land. Needs water outlines, which are fetched even with Water outlines and Water depth off. See <a href={`${base}/guides/water-paint-templates`}>water paint templates</a>.</td></tr>
      <tr><td>Acrylic water inserts</td><td>On, off</td><td>Off</td><td><em>Layered</em>, with Water depth on. Cuts each lake's shoreline out of the sheet that carries its waterline and exports a fitted acrylic insert for it, as separate acrylic files with their own sheet layout. The sheet below gets a 2 mm ledge for the insert to rest on, and map detail over the water is engraved on the acrylic. Lakes on the bottom sheet, and arms narrower than 3 mm, stay wood. Each lake can be switched back to wood in the list below the switch.</td></tr>
      <tr><td>Acrylic thickness</td><td>0.5–25 mm</td><td>Material thickness</td><td><em>With acrylic inserts</em>. Thinner than the wood sits just below the shore; thicker stands proud of it, with a warning.</td></tr>
      <tr><td>Acrylic kerf</td><td>0–1 mm</td><td>Laser kerf</td><td><em>With acrylic inserts</em>. Full kerf width in acrylic; half is applied to each side of an insert's cut.</td></tr>
      <tr><td>Fit clearance</td><td>0–0.5 mm</td><td>0.1 mm</td><td><em>With acrylic inserts</em>. Gap left between each insert and its wood opening on every side, so it drops in without forcing.</td></tr>
      <tr><td>Smooth contours</td><td>On, off</td><td>On</td><td>Rounds sharp corners on contour shapes.</td></tr>
      <tr><td>Glue margin</td><td>2–25 mm</td><td>8 mm</td><td><em>Layered</em>, with nests on. Covered glue area kept around nested pieces.</td></tr>
      <tr><td>Laser kerf</td><td>0–1 mm</td><td>0.15 mm</td><td><em>Layered</em>. Full kerf width; half is applied to each side of a cut.</td></tr>
      <tr><td>Work area width, Work area height</td><td>0 or 20 mm and up</td><td>0 (off)</td><td><em>Layered</em>. Your laser bed. Layers larger than it are split into tiles that fit; 0 leaves that axis unlimited. See <a href={`${base}/guides/split-large-maps`}>split large maps</a>.</td></tr>
      <tr><td>Seam offset</td><td>0–50 mm</td><td>10 mm</td><td><em>Layered</em>, when split. How far seams shift between alternating layers, so no seam sits over another.</td></tr>
      <tr><td>Puzzle seam tabs</td><td>On, off</td><td>On</td><td><em>Layered</em>, when split. Cuts covered seams as interlocking tabs so each piece only fits its neighbour.</td></tr>
      <tr><td>Assembly labels</td><td>On, off</td><td>On</td><td><em>Layered</em>, when split. Engraves each piece's id, such as <code>L03-B2</code>, where the next layer hides it.</td></tr>
      <tr><td>Minimum feature</td><td>0.2–5 mm</td><td>0.8 mm</td><td>Pieces, holes, and short lines smaller than this are removed. Contour detail stays the same at any setting, so raising it clears specks without coarsening the outlines that remain.</td></tr>
    </tbody>
  </table>

  <h2>Preview</h2>
  <table>
    <thead><tr><th scope="col">Control</th><th scope="col">Range or options</th><th scope="col">Default</th><th scope="col">Notes</th></tr></thead>
    <tbody>
      <tr><td>Preview mode</td><td>Map, Cut layers, 3D stack (layered); Map, Engraving (flat)</td><td>3D stack</td><td>Does not affect exports.</td></tr>
      <tr><td>Layer</td><td>Any generated layer</td><td></td><td><em>Layered</em>. Selects the sheet shown in Cut layers.</td></tr>
      <tr><td>Stack–Exploded</td><td>0–1</td><td>0.35</td><td><em>Layered</em>, 3D stack only.</td></tr>
    </tbody>
  </table>

  <h2>Related pages</h2>
  <p>See <a href={`${base}/guides/export-files`}>export files</a> for what each download contains and <a href={`${base}/guides/troubleshooting`}>troubleshooting</a> for warnings and blocked exports.</p>
</Article>

<style>
  table { width: 100%; border-collapse: collapse; margin-block: 16px 32px; font-size: 14px; }
  th, td { padding: 9px 10px 9px 0; border-bottom: 1px solid var(--loidolt-border); text-align: left; vertical-align: top; line-height: 1.55; }
  th { font-size: 12px; color: var(--loidolt-text-muted); font-weight: 600; }
  td:first-child { font-weight: 600; }
  @media (max-width: 700px) {
    table, tbody, tr, td { display: block; }
    thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    tr { padding-block: 10px; border-bottom: 1px solid var(--loidolt-border); }
    td { padding: 2px 0; border: 0; }
    td:empty { display: none; }
    td:nth-child(2)::before { content: "Range: "; color: var(--loidolt-text-muted); }
    td:nth-child(3)::before { content: "Default: "; color: var(--loidolt-text-muted); }
  }
</style>
