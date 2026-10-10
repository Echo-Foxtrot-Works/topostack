<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="A tour of the TopoStack studio" intro="Where everything lives in the studio, what updates instantly and what needs fresh terrain, and how your work is saved.">
  <h2>What you need</h2>
  <p>A current browser with an internet connection. TopoStack is free and needs no account. A larger screen makes the settings and preview easier to use side by side.</p>

  <h2>1. The top bar</h2>
  <ul>
    <li><strong>Project name</strong> names your project and its exported files. The arrow beside it opens the project menu:
      <ul>
        <li><strong>Import project JSON</strong> opens a project settings file (up to 2 MB) you exported earlier.</li>
        <li><strong>Copy share link</strong> copies a link that opens this design.</li>
        <li><strong>Reset project</strong> restores the Crater Lake preview and all default settings, clearing custom markers and lines. The reset saves automatically; use Undo to recover your previous settings.</li>
      </ul>
    </li>
    <li><strong>Undo</strong> and <strong>Redo</strong> step through your edits.</li>
    <li><strong>Export</strong> opens the download options. The dot on the button turns green when the project is ready to export. See <a href={`${base}/guides/export-files`}>export files</a>.</li>
    <li>The ⋯ menu at the far right holds the color scheme, what's new, the guides and the TopoStack home page.</li>
  </ul>
  <p>Below it, choose the output type: <strong>Layered</strong> for a stack of cut sheets, or <strong>Flat</strong> for one engraved surface. Above the preview, a readout shows the finished size, the layer count, cut panels and stack height for layered output (or the contour count for flat output), and the elevation range.</p>

  <h2>2. Choose a place</h2>
  <p>In <strong>Project setup</strong>, select the location card to open the place picker. You can:</p>
  <ul>
    <li>search for a mountain, lake, park, city or address;</li>
    <li>enter latitude and longitude in decimal degrees, then select <strong>Use coordinates</strong>;</li>
    <li>select <strong>Use current location</strong>;</li>
    <li>pick from <strong>Surveyed lakes</strong>, which also switches to layered output with water depth on; or</li>
    <li>open <strong>Example locations</strong>: Crater Lake, Grand Teton and Jenny Lake, Mount Rainier and the Grand Canyon. The same examples appear as buttons under the location card.</li>
  </ul>
  <p>Choosing a place renames the project and moves the map, but keeps your other settings.</p>

  <h2>3. Frame the map area</h2>
  <p>The <strong>Map</strong> preview shows the area that will become your artwork. Pan and zoom the map to position it. Drag the frame's corner or edge handles to resize it: the physical size changes with the frame, so the map scale stays the same. Hold Shift or turn on <strong>Lock aspect ratio</strong> to keep the proportions. Circles always keep theirs.</p>

  <h2>4. Work through the settings</h2>
  <p>The numbered sections on the left follow the order you usually need them. Each heading summarizes its current values; select it to expand or collapse it.</p>
  <table>
    <thead><tr><th scope="col">Section</th><th scope="col">What it controls</th></tr></thead>
    <tbody>
      <tr><td>01–02 Project setup</td><td>Location and map area.</td></tr>
      <tr><td>03 Cut size / Artwork size</td><td>Metric or imperial units, rectangle or circle, finished width and height.</td></tr>
      <tr><td>04 Terrain layers / Contour design</td><td>Vertical exaggeration and material thickness, or contour density and index contours.</td></tr>
      <tr><td>05 Map details</td><td>Roads, trails, water, boundaries, grid, water depth, assembly guides, labels, north arrow, scale bar and text. See <a href={`${base}/guides/map-details`}>map details and linework</a>.</td></tr>
      <tr><td>06 Linework</td><td>Line width presets and individual stroke widths.</td></tr>
      <tr><td>07 Fabrication settings / Artwork settings</td><td>Nesting, acrylic water inserts, airspace in 3D, glue margin, kerf, contour smoothing and minimum feature size.</td></tr>
    </tbody>
  </table>
  <p>Every control, with its range and default, is listed in the <a href={`${base}/guides/settings-reference`}>settings reference</a>.</p>

  <h2>5. Generate and preview</h2>
  <p>Select <strong>Generate terrain</strong> at the bottom of the settings to fetch real elevation and map data for the framed area. While it runs, the button becomes <strong>Cancel generation</strong>. The status line above it reports progress and anything that blocks export, and <strong>Terrain sources</strong> lists the elevation data used.</p>
  <p>Switch previews above the artwork:</p>
  <ul>
    <li><strong>Map</strong>: the location map and frame.</li>
    <li><strong>Cut layers</strong> (layered): one sheet at a time. Use the layer slider below the preview to step through elevations.</li>
    <li><strong>3D stack</strong> (layered): the assembled model. Drag the Stack–Exploded slider to separate the layers.</li>
    <li><strong>Engraving</strong> (flat): the finished engraving.</li>
    <li><strong>Custom data</strong>: depth charts, markers, trails and boundaries, graphics and file import, each with its own sidebar section. See <a href={`${base}/guides/custom-data`}>bring your own data</a>.</li>
  </ul>
  <p>Warnings appear over the preview. Dismiss each once you have read it; see <a href={`${base}/guides/troubleshooting`}>troubleshooting</a> for what they mean.</p>

  <h2>What needs fresh terrain</h2>
  <p>Changing the location or map area, including a cut aspect-ratio change that selects a new area, needs <strong>Regenerate terrain</strong> before export. Badges beside those controls say <strong>Regeneration pending</strong> until you do.</p>
  <p>Terrain exaggeration and other settings, including size at the same proportions, map details, custom data, linework and fabrication settings, updates the preview on its own. Turning on a detail that was not loaded fetches its data in the background.</p>

  <h2>Saving your work</h2>
  <p>Projects save automatically in this browser as you work, and reopen when you return. To keep a backup or move to another device, export <strong>Project settings</strong> and import it with <strong>Import project JSON</strong>. Imported projects need fresh terrain before export. Clearing site data or using a private window starts from scratch.</p>

  <h2>Next steps</h2>
  <p>Follow the <a href={`${base}/examples/crater-lake`}>Crater Lake example</a> for a first project, then the <a href={`${base}/guides/laser-cut-topographic-map`}>layered map guide</a> or the <a href={`${base}/guides/topographic-map-engraving`}>engraving guide</a>.</p>
  <h2>Build airspace above your terrain</h2>
  <p>Choose <strong>Layered</strong>, then turn on <strong>Airspace in 3D</strong> in <strong>Fabrication settings</strong>. Preview the result in <strong>3D stack</strong>; choose <strong>Airspace acrylic</strong> in <strong>Cut layers</strong> to inspect its levels. Follow the <a href={`${base}/guides/airspace-in-3d`}>airspace design guide</a> and <a href={`${base}/guides/airspace-assembly`}>assembly guide</a>.</p>
</Article>
