<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Bring your own data into TopoStack" intro="The Custom data view holds everything you add to a map yourself: depth charts for lakes, markers for places that matter, trails and boundaries, logos and artwork, and files from your GPS or mapping app.">
  <h2>Open the Custom data view</h2>
  <p>Select <strong>Custom data</strong> above the preview, beside <strong>Map</strong>, <strong>Cut layers</strong> and <strong>3D stack</strong> (or <strong>Engraving</strong> for flat output). While it is open, the sidebar swaps the project's settings for a rail with one tab per kind of data. The rest of your project is unchanged; switch back to any other view to return to it.</p>
  <p>Choose a tab to open its section. Each section shows what its tools work on beside it: the chart you are tracing, the map you place markers and paths on, or the piece you place graphics on. Work in progress, such as a half-traced chart, survives switching tabs, and switching to another view and back.</p>

  <h2>The sections</h2>
  <table>
    <thead><tr><th scope="col">Section</th><th scope="col">Rail tab</th><th scope="col">What it adds</th><th scope="col">Guide</th></tr></thead>
    <tbody>
      <tr><td><strong>Depth charts</strong></td><td><strong>Charts</strong></td><td>A lake floor from reviewed chart contours and explicit geographic alignment. Layered output only.</td><td><a href={`${base}/guides/trace-a-depth-chart`}>Carve a lake from a depth chart</a></td></tr>
      <tr><td><strong>Markers</strong></td><td><strong>Markers</strong></td><td>Engraved symbols at map coordinates: built-in pins, stars and crosses, or your own SVG icons.</td><td><a href={`${base}/guides/custom-markers-and-paths`}>Custom markers and paths</a></td></tr>
      <tr><td><strong>Trails &amp; boundaries</strong></td><td><strong>Paths</strong></td><td>Routes and outlines drawn on the map or typed as coordinates, engraved in your trail and boundary styles.</td><td><a href={`${base}/guides/custom-markers-and-paths`}>Custom markers and paths</a></td></tr>
      <tr><td><strong>Graphics</strong></td><td><strong>Graphics</strong></td><td>SVG logos and artwork placed on the piece itself, then engraved, scored or cut out.</td><td><a href={`${base}/guides/custom-graphics`}>Custom graphics</a></td></tr>
      <tr><td><strong>Import</strong></td><td><strong>Import</strong></td><td>Markers, trails and boundaries read from a GPX, KML or GeoJSON file in one step.</td><td><a href={`${base}/guides/custom-markers-and-paths`}>Custom markers and paths</a></td></tr>
    </tbody>
  </table>
  <p>Each section's heading sums up what it holds, such as how many markers are placed or how many lakes a chart carves. Hover over a tab in the rail to see the same summary without leaving the section you are in.</p>

  <h2>Placed on the map, or on the piece</h2>
  <p>Markers, trails, boundaries and imported files belong to a place on the ground. They are stored as latitude and longitude, so they stay put when you move the frame or change the output size, and anything outside the framed area stays saved but is not engraved.</p>
  <p>Graphics belong to the piece instead. They are placed in millimetres on the finished artwork and keep their place when you move the map underneath.</p>
  <p>Depth charts belong to a lake. A chart carves its lake whenever that lake is in the framed area, and does nothing otherwise.</p>

  <h2>What updates on its own</h2>
  <p>Markers, paths and graphics update the preview immediately, with no need to regenerate terrain. A depth chart changes the lake floor itself, so after choosing <strong>Use for</strong> on a chart, select <strong>Regenerate terrain</strong> to carve it.</p>
  <p>Project <strong>Undo</strong> reverses marker, path, and graphic edits. A whole file import, a path drawn with many clicks, or a graphic placement session each count as a single step. Contour correction has its own <strong>Undo edit</strong> and <strong>Redo edit</strong> controls.</p>

  <p>Depth charts require confirmation of every included contour, at least four distributed geographic control points, and a separate layer review before saving. Use <strong>Export review draft</strong> before closing or reloading unfinished work; keep the original source file to restore it. Read <a href={`${base}/guides/how-depth-chart-tracing-works`}>how chart tracing works</a> for its current limits.</p>

  <h2>Layered and flat output</h2>
  <p>On a layered map, markers and graphics land on whichever sheet shows at each point, so they are visible once the stack is glued. On a flat engraving, everything is engraved on the one surface. Flat engravings have no lake floor, so the <strong>Depth charts</strong> section is hidden; the other four work the same way in both.</p>

  <h2>Names are for you</h2>
  <p>Type over the number at the top of any marker or path card to name it. Names help you find things in a long list and show when you hover a marker on the map. Nothing is engraved from them, and renaming never marks terrain for regeneration.</p>

  <h2>Saving and sharing</h2>
  <table>
    <thead><tr><th scope="col">Data</th><th scope="col">Saved in this browser</th><th scope="col">Project settings file</th><th scope="col">Share link</th></tr></thead>
    <tbody>
      <tr><td>Markers, trails, boundaries</td><td>Yes</td><td>Yes</td><td>Yes</td></tr>
      <tr><td>Marker icons and graphics</td><td>Yes, as shapes</td><td>Yes</td><td>Yes, if the link stays small enough</td></tr>
      <tr><td>Depth charts</td><td>Yes</td><td>Yes, the charts the project uses</td><td>No</td></tr>
    </tbody>
  </table>
  <p>Only the shapes read from an uploaded SVG are kept, never the file itself, and only the depths traced from a chart, never the picture. Chart pictures and SVG files never leave your browser, and custom data is left out of usage events and optional feedback diagnostics. To move a project with its charts to another computer, export <strong>Project settings</strong> and import the file there.</p>

  <h2>Limits at a glance</h2>
  <ul>
    <li>Markers and paths: up to 250 of each, with up to 2,000 points in one path and 10,000 in total.</li>
    <li>Marker icons: up to 24 per project. Graphics: up to 24 in the library and 50 placed.</li>
    <li>SVG uploads up to 1 MB; GPX, KML and GeoJSON imports up to 20 MB.</li>
    <li>Chart pictures are reduced to 2,400 pixels on their longer side. Project files with charts can be up to 24 MB.</li>
  </ul>

  <h2>Next steps</h2>
  <p>Start with the section you need from the table above. Every control and its range is also listed in the <a href={`${base}/guides/settings-reference`}>settings reference</a>.</p>
</Article>
