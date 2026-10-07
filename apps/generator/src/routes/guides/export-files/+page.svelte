<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Export files and SVG structure" intro="What each TopoStack download contains, how the SVG files are organized, and which files to use in your laser software.">
  <h2>Download options</h2>
  <p>Open <strong>Export</strong> in the studio. The recommended <strong>Complete project</strong> download contains everything below; the other files are listed under <strong>Individual files</strong>, and <strong>Project settings</strong> sits beneath them. Everything except project settings needs freshly generated real terrain with no export-blocking messages.</p>
  <dl class="options">
    <div><dt>Complete project <span>ZIP</span></dt><dd>Every file listed below for your output type. Recommended when you are unsure.</dd></div>
    <div><dt>Master SVG / Engraving SVG <span>SVG</span></dt><dd>The single main artwork file on its own: every layered panel on one sheet, or the flat engraving.</dd></div>
    <div><dt>Cut panels <span>ZIP · layered</span></dt><dd>One SVG per fabrication panel with its cut, score and engrave paths, plus README.txt and ATTRIBUTION.txt.</dd></div>
    <div><dt>Engraving panels <span>ZIP · layered</span></dt><dd>The engraving-only companion for each panel, plus README.txt and ATTRIBUTION.txt.</dd></div>
    <div><dt>Paint templates <span>ZIP · layered</span></dt><dd>With <strong>Water paint templates</strong> on: a paper stencil for each panel that has visible water, plus README.txt and ATTRIBUTION.txt.</dd></div>
    <div><dt>Acrylic inserts <span>ZIP · layered</span></dt><dd>With <strong>Acrylic water inserts</strong> on: the acrylic panels or sheets, their engraving-only companions and the acrylic master, plus README.txt and ATTRIBUTION.txt.</dd></div>
    <div><dt>Assembly guide <span>SVG · layered</span></dt><dd>The stacking reference on its own.</dd></div>
    <div><dt>Project settings <span>JSON</span></dt><dd>Your settings, for backup or to continue on another device. Always available, even when artwork export is blocked.</dd></div>
  </dl>
  <p>ZIP and file names start with your project name, lower-cased with spaces replaced by hyphens. The examples below use <code>my-map</code>. The combined download is limited to 100 MB; if a project exceeds it, reduce the map details or the size of the map area.</p>

  <h2>Layered relief files</h2>
  <table>
    <thead><tr><th scope="col">File</th><th scope="col">Contents</th></tr></thead>
    <tbody>
      <tr><td><code>my-map-master.svg</code></td><td>Every fabrication panel laid out in a grid of up to four columns, 12 mm apart, with shared CUT, SCORE and ENGRAVE groups.</td></tr>
      <tr><td><code>my-map-layer-03.svg</code></td><td>A panel holding one layer, with its cut, score and engrave paths.</td></tr>
      <tr><td><code>my-map-panel-02-layers-02-05.svg</code></td><td>A panel holding more than one layer because of material-saving nests: here, layer 05 is cut from inside layer 02's sheet.</td></tr>
      <tr><td><code>my-map-layer-03-b2.svg</code></td><td>With a work area set, one panel per tile of a split layer: column B, row 2. A piece that needs its own sheet adds a number, as in <code>-b2-2</code>.</td></tr>
      <tr><td><code>…-engrave.svg</code></td><td>The engraving-only companion of the panel with the same name, in the same position. It has no cut or score paths.</td></tr>
      <tr><td><code>…-paint-water.svg</code></td><td>A paper stencil registered to the panel with the same name. It is the cut piece at nominal size (cut it with kerf compensation off) with the water that stays visible once the stack is glued cut away, reaching 1.5 mm under the layer above so a slightly misplaced stencil leaves no bare edge. Where water meets the piece edge the stencil stops short of it, so register on the edges and tabs it keeps. Lay it flush to the piece, spray, and remove it before gluing. Only written when <strong>Water paint templates</strong> is on and the panel has visible water.</td></tr>
      <tr><td><code>my-map-acrylic-04.svg</code></td><td>With <strong>Acrylic water inserts</strong> on: the acrylic inserts that fill the lake openings in layer 04, cut and engraved as their own job with your acrylic settings. Each insert is smaller than its opening by the fit clearance and compensated for the acrylic kerf. An insert too large to share a panel with the others gets its own, as in <code>-acrylic-04-w2.svg</code>; nested acrylic is written as <code>my-map-acrylic-sheet-01.svg</code>. Each has an <code>-engrave.svg</code> companion, and <code>my-map-acrylic-master.svg</code> holds them all. Inserts carry no engraved ids: the assembly guide names them W1, W2 and so on.</td></tr>
      <tr><td><code>my-map-assembly-guide.html</code></td><td>A step-by-step assembly booklet that opens in any browser and prints on US Letter: finished size and materials, a checklist of sheets to cut, what the engraved marks mean, and one illustrated step per layer from layer 01 upward, showing the stack so far with the new layer highlighted, which sheet its pieces come from, and where split pieces go.</td></tr>
      <tr><td><code>README.txt</code></td><td>Layer count, finished stack height, applied vertical exaggeration and horizontal scale, any lake depth fitting, line widths, panel count, colors, kerf and nesting notes.</td></tr>
      <tr><td><code>my-map-project.json</code></td><td>Your settings plus generation details (see below).</td></tr>
      <tr><td><code>ATTRIBUTION.txt</code></td><td>Credits for the data used (see below).</td></tr>
    </tbody>
  </table>
  <p class="note"><strong>Use one engraving copy per panel.</strong> Either process the complete panel SVG, or cut from the panel SVG and engrave from its <code>-engrave.svg</code> companion with the panel's engraving disabled. Processing both engraves the same paths twice.</p>

  <h2>Flat engraving files</h2>
  <table>
    <thead><tr><th scope="col">File</th><th scope="col">Contents</th></tr></thead>
    <tbody>
      <tr><td><code>my-map-engraving.svg</code></td><td>The artwork at physical size, containing engraving paths only.</td></tr>
      <tr><td><code>README.txt</code></td><td>Artwork size, contour count, index interval, water fill, line widths, map details and border.</td></tr>
      <tr><td><code>my-map-project.json</code></td><td>Your settings plus generation details.</td></tr>
      <tr><td><code>ATTRIBUTION.txt</code></td><td>Credits for the data used.</td></tr>
    </tbody>
  </table>

  <h2>Colors and operation groups</h2>
  <p>Every SVG sets its width and height in millimeters, so it should import at the finished size. Paths are grouped by the operation TopoStack intends:</p>
  <table>
    <thead><tr><th scope="col">Group</th><th scope="col">Stroke</th><th scope="col">Used for</th></tr></thead>
    <tbody>
      <tr><td><code>CUT</code></td><td><span class="swatch cut" aria-hidden="true"></span>Red <code>#FE0002</code></td><td>Layer outlines and holes (layered only).</td></tr>
      <tr><td><code>SCORE</code></td><td><span class="swatch line" aria-hidden="true"></span>Blue <code>#2366FF</code></td><td>Water shorelines and rivers (layered only).</td></tr>
      <tr><td><code>ENGRAVE</code></td><td><span class="swatch line" aria-hidden="true"></span>Blue <code>#2366FF</code></td><td>Roads, trails, labels, boundaries, the coordinate grid, north arrow, markers, alignment marks, and in flat output the contours and border.</td></tr>
    </tbody>
  </table>
  <p>Choose Score for blue linework in both SCORE and ENGRAVE groups, Cut for red outlines, and Engrave only for intentionally filled blue artwork. Group names organize the SVG; verify the processing type in Studio. Inside ENGRAVE, detail groups are named by feature so you can give them separate line weights or turn them off:</p>
  <ul>
    <li><strong>Layered:</strong> each panel has a <code>fabrication-panel-N-ENGRAVE</code> group listing its layers in a <code>data-layers</code> attribute. Inside it, each layer has groups such as <code>layer-03-ENGRAVE-trails</code>, <code>-major-roads</code>, <code>-local-roads</code>, <code>-transport-labels</code>, <code>-water</code>, <code>-boundaries</code>, <code>-coordinate-grid</code>, <code>-annotations</code> and <code>-general</code>.</li>
    <li><strong>Flat:</strong> <code>ENGRAVE-contours-minor</code>, <code>ENGRAVE-contours-index</code>, <code>ENGRAVE-water-fill</code>, <code>ENGRAVE-map-details</code> (with the same feature subgroups) and <code>ENGRAVE-border</code>.</li>
  </ul>
  <p>Marker clearances are gaps in the exported line geometry, not white fabrication objects. Solid marker symbols retain their blue fill with no duplicate outline stroke; use Engrave for those filled shapes.</p>

  <h2 id="kerf-panel-size-and-alignment-marks">Kerf, panel size and alignment marks</h2>
  <p>In layered output, <strong>Laser kerf</strong> in Fabrication settings is the full width your beam removes. Outer cuts move outward and holes move inward by half that width, so the finished pieces match the artwork. Each panel's canvas is enlarged by the kerf to make room. Set Laser kerf to 0 if your laser software applies its own compensation.</p>
  <p>When <strong>Assembly guides</strong> is on, each lower layer has an engraved outline of the layer above it, inset by the kerf, labeled with that layer’s number (for example <code>L04</code> on layer 03). They are hidden once the next layer is glued in place.</p>
  <p>When <strong>Work area width</strong> or <strong>Work area height</strong> splits a layer, each piece also engraves its id, such as <code>L03-B2</code> (layer 03, column B, row 2), in a separate green (<code>#00A651</code>) <code>ASSEMBLY</code> group where the next layer will cover it. Assign that color to Score or turn off <strong>Assembly labels</strong> if you don't want it. Seam edges get the same kerf compensation as every other cut, so pieces butt together at their intended size.</p>

  <h2>Project file</h2>
  <p><code>my-map-project.json</code> holds your full settings, so you can import it in the studio to continue. It also records the generation date, elevation range, map bounds, terrain resolution and sources, data versions, warnings, and for layered output each layer's elevation and file, panel and nesting details, and each lake's depth source and applied depth scaling. Imported projects need fresh terrain generation before export.</p>
  <p>The <strong>Project settings</strong> download contains the settings only, and imports the same way.</p>

  <h2>Credits</h2>
  <p><code>ATTRIBUTION.txt</code> lists the credits and licenses of the terrain, map, lake outline and survey sources used, and the terrain imagery sources reported by the provider. Keep it with the artwork when you share or sell a piece. <a href={`${base}/attribution`}>Sources and attribution</a> describes every source TopoStack can use.</p>
  <p>Every SVG also carries a short “Made with TopoStack” credit in its <code>&lt;desc&gt;</code> description, and README.txt ends with the same line. The description is file metadata: it is not a path, so it never draws, cuts or engraves.</p>

  <h2>Next steps</h2>
  <p>Follow the <a href={`${base}/guides/laser-cut-topographic-map`}>layered map guide</a> or the <a href={`${base}/guides/topographic-map-engraving`}>engraving guide</a>, or see <a href={`${base}/guides/troubleshooting`}>troubleshooting</a> if export is blocked.</p>
</Article>

<style>
  .options > div { padding-block: 14px; border-bottom: 1px solid var(--loidolt-border); }
  dt { font-weight: 600; }
  dt span { margin-left: 8px; font: 12px var(--loidolt-font-utility); color: var(--loidolt-text-muted); }
  dd { margin: 6px 0 0; line-height: 1.7; }
  td:first-child code { white-space: nowrap; }
  .swatch { display: inline-block; width: 10px; height: 10px; margin-right: 6px; border-radius: 2px; }
  .swatch.cut { background: #fe0002; }
  .swatch.line { background: #2366ff; }
  @media (max-width: 700px) {
    table, tbody, tr, td { display: block; }
    thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
    tr { padding-block: 10px; border-bottom: 1px solid var(--loidolt-border); }
    td { padding: 2px 0; border: 0; font-size: 14px; }
    td:first-child code { white-space: normal; overflow-wrap: anywhere; }
  }
</style>
