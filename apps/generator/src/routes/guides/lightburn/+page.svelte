<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Use TopoStack SVG files in LightBurn" intro="Import a terrain project, check its dimensions, assign each operation and preview the job before cutting or engraving.">
  <p>Begin with the <a href={`${base}/studio?starter=relief`}>small layered relief</a> or <a href={`${base}/studio?starter=engraving`}>flat contour engraving</a>. Review the size and actual material thickness, generate fresh terrain, then use <strong>Complete project</strong> in Export. The download includes SVG artwork, project settings and source credits; a layered relief also includes its assembly booklet.</p>

  <h2>Choose the file for the job</h2>
  <ul>
    <li>For a layered relief, unzip the download and choose one wood panel or nested sheet SVG. The master SVG puts all panels together and may exceed your bed size.</li>
    <li>For a flat engraving, use the file ending in <code>-engraving.svg</code>.</li>
    <li>A panel SVG already includes its linework. Its <code>-engrave.svg</code> companion is for a separate engraving job. Processing both copies engraves the same detail twice.</li>
    <li>Acrylic inserts use their own material and files. Keep them separate from wood panels.</li>
  </ul>
  <p>See <a href={`${base}/guides/export-files`}>export files and SVG structure</a> for filenames, paint stencils and the assembly guide.</p>

  <h2>Import and verify the size</h2>
  <p>In LightBurn, use File → Import to bring the SVG into your project. SVG is a supported vector format; see <a href="https://docs.lightburnsoftware.com/latest/Reference/FileManagement/#import">LightBurn’s import reference</a>.</p>
  <p>Select the imported artwork and read its width and height in millimeters in the Numeric Edits toolbar. Compare them with the intended panel or sheet dimensions in TopoStack and the export README. With kerf applied, a panel canvas can be slightly larger; LightBurn measures the selected geometry, which may differ from the SVG canvas or a whole multi-panel master. For a flat engraving, check the border when it is enabled. Use <a href="https://docs.lightburnsoftware.com/latest/Reference/NumericEditsToolbar/">LightBurn’s size controls</a> to inspect dimensions, and resolve an unexpected scale before changing it by eye.</p>

  <h2>Assign colors to operations</h2>
  <p>LightBurn maps vector colors to processing layers. SVG group names such as <code>CUT</code>, <code>SCORE</code> and <code>ENGRAVE</code> do not assign machine settings. Check each imported layer in the Cuts / Layers window. See <a href="https://docs.lightburnsoftware.com/latest/GetStarted/ColorsAndLayers/">colors and layers</a> and <a href="https://docs.lightburnsoftware.com/latest/GetStarted/CutSettingsBeginner/">cut settings</a> in LightBurn’s documentation.</p>
  <table>
    <thead><tr><th scope="col">TopoStack artwork</th><th scope="col">LightBurn operation</th></tr></thead>
    <tbody>
      <tr><td>Red <code>#FE0002</code> outlines and holes</td><td>Line mode with your tested through-cut settings.</td></tr>
      <tr><td>Blue <code>#2366FF</code> contours, roads, labels and shorelines</td><td>Line mode with your tested marking settings. Both SCORE and ENGRAVE linework use blue.</td></tr>
      <tr><td>Green <code>#00A651</code> assembly ids</td><td>Line mode with marking settings; these ids help position split pieces.</td></tr>
      <tr><td>Intentionally filled symbols or graphics</td><td>Put the filled shapes on a separate color layer and use Fill mode. Keep ordinary contour lines on their line layer.</td></tr>
    </tbody>
  </table>
  <p>Import colors may map to LightBurn’s palette rather than preserve their exact hexadecimal values. Identify the actual shapes on each layer. Review speed, power, passes and output status for your machine and material; the SVG does not supply those settings. Mark detail before releasing pieces with the final cut.</p>

  <h2>Apply kerf compensation once</h2>
  <p>If TopoStack’s <strong>Laser kerf</strong> is nonzero, its wood cut paths already include compensation. Leave LightBurn’s Kerf Offset at zero for those paths. If you use a tested LightBurn offset instead, set TopoStack’s Laser kerf to zero and regenerate or refresh before exporting.</p>
  <p>The values use different conventions: TopoStack takes the full beam width and moves each edge by half; LightBurn takes an edge offset. Do not copy the same number between them. Paint stencils are nominal-size artwork and should be cut without kerf compensation. Acrylic has its own TopoStack kerf setting; check its README separately. See <a href="https://docs.lightburnsoftware.com/latest/Guides/Test-KerfOffset/">LightBurn’s kerf guide</a> for its offset behavior and test procedure.</p>

  <h2>Preview, then follow the assembly guide</h2>
  <p>Open LightBurn’s Preview window and inspect the processing sequence, outlines, holes and marked detail. Confirm there are no duplicate companion engravings and that closed contours have not accidentally become filled areas. Preview includes the configured kerf offset; see <a href="https://docs.lightburnsoftware.com/latest/Reference/Preview/">LightBurn’s Preview reference</a>.</p>
  <p>Check the job fits your work area using your usual framing workflow and tested material settings. After cutting a layered project, open its <code>-assembly-guide.html</code> booklet and follow the numbered sheets and layers. If the map is too large for your bed, <a href={`${base}/guides/split-large-maps`}>split it in TopoStack</a> before exporting. If export is blocked, follow <a href={`${base}/guides/troubleshooting`}>troubleshooting</a>.</p>
  <p class="note">This guide describes TopoStack’s exported artwork and LightBurn’s documented workflow, checked October 8, 2026. It is not a report of a physical test on a particular laser.</p>
</Article>
