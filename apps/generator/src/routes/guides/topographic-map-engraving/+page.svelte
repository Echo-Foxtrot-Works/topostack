<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Create a topographic map SVG for laser engraving" intro="Draw a landscape with contour lines on one surface. TopoStack's flat engraving workflow exports one SVG at your chosen physical size, with optional roads, trails, water and labels.">
  <h2>What you need</h2>
  <p>A browser with an internet connection, a surface to engrave, and laser software that can import SVG files. TopoStack is free to use and needs no account. It prepares artwork; you choose the machine settings for your material.</p>
  <h2>1. Choose flat engraving and set the size</h2>
  <p><a href={`${base}/studio`}>Open the studio</a>, choose a location and select <strong>Flat</strong>. In the <strong>Place</strong> panel, choose a rectangle or circle, and enter the finished width (and height, for a rectangle). Choose flat engraving when you want a contour drawing rather than a stack of cut sheets.</p>
  <h2>2. Balance contour density and readability</h2>
  <p>In the <strong>Terrain</strong> panel, <strong>Contour density</strong> sets 4–40 lines across the elevation range. Start with a moderate count, then increase it if the terrain needs more detail. Tight slopes produce close lines, so inspect them at your finished size.</p>
  <p>The density setting divides the selected elevation range; it is not a fixed elevation interval, so the same count gives different spacing in different places. <strong>Index contour</strong> draws every chosen line (every 2nd to 10th) with a stronger stroke to help readers follow the landscape.</p>
  <h2>3. Add context without crowding the contours</h2>
  <p>Roads, trails, state or province boundaries and a coordinate grid in the <strong>Features</strong> panel, water outlines in the <strong>Water</strong> panel, and elevation labels, a compass and a scale bar in the <strong>Labels</strong> panel are all optional. Water can be filled with lines, ripples or dots, or left as an outline. Turn off details that compete with the shape of the terrain.</p>
  <p>At the top of the <strong>Features</strong> panel, choose a Fine, Balanced or Bold line weight, then adjust individual widths under each feature's switch as needed. Contour widths are in the <strong>Terrain</strong> panel. Widths are SVG stroke widths at physical size. Actual burn width also depends on your laser, material and how your software processes vector strokes.</p>
  <h2>4. Generate, preview and export</h2>
  <ol>
    <li>Select <strong>Generate terrain</strong> (<strong>Regenerate terrain</strong> after the first generation) to fetch real elevation and the requested map details.</li>
    <li>Inspect the flat engraving preview. If data is unavailable or settings are stale, resolve the message before exporting.</li>
    <li>Open <strong>Export</strong> and download the recommended <strong>Complete project</strong>, or the artwork alone as <strong>Engraving SVG</strong> under <strong>Individual files</strong>.</li>
    <li>Import the SVG into your laser software and confirm its physical dimensions and engraving operation.</li>
  </ol>
  <p>The primary file ends in <strong>-engraving.svg</strong>. It contains one blue (<code>#2366FF</code>) <strong>ENGRAVE</strong> group with named detail groups, and no CUT or SCORE groups. The complete project adds a project file with your settings, a README and <strong>ATTRIBUTION.txt</strong>.</p>
  <h2>Check before you engrave</h2>
  <p class="note">A successful SVG export prepares artwork, not machine settings. Verify the scale and the engraving operation, and make a small test on your material before engraving the full piece.</p>
  <h2>Common questions</h2>
  <h3>Does flat engraving use material thickness or lake depth?</h3>
  <p>No. Sheet thickness, vertical exaggeration, water depth, nesting, kerf and assembly guides belong to layered relief. Flat engraving controls the contour drawing on one surface.</p>
  <h3>Can I save the project and return later?</h3>
  <p>Settings are saved in this browser. Export a project-settings JSON backup to move them to another device or keep a separate copy. Imported or restored settings need fresh terrain generation before artwork export. Clearing browser storage removes the local settings.</p>
  <h2>Next steps</h2>
  <p>Try the same place in the <a href={`${base}/examples/crater-lake`}>Crater Lake example</a>, or see <a href={`${base}/guides/laser-cut-topographic-map`}>how to make a layered topographic map</a>.</p>
</Article>
