<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  const base = basePath();
</script>

<Article title="Use TopoStack projects in xTool Studio" intro="Open a Studio project with each sheet on its own canvas, or import an SVG and assign its processing colors.">
  <p>Begin with the <a href={`${base}/studio?starter=relief`}>small layered relief</a> or <a href={`${base}/studio?starter=engraving`}>flat contour engraving</a>. Review the size and actual material thickness, generate fresh terrain, then open Export. Choose <strong>Complete project</strong> for the assembly booklet, SVGs and source credits that accompany a layered relief.</p>

  <h2>Open a Studio project with a canvas per panel</h2>
  <p>On topostack.app, choose Export → Individual files → <strong>xTool Studio project</strong>. Open the <code>.xs</code> file in Studio 1.7 or later. In the Canvas panel, click the named thumbnail for the panel or nested stock sheet on your bed. Each canvas includes that sheet’s cuts and marks. A flat engraving opens on a single canvas.</p>
  <p>Select your device, choose the processing mode for each named layer and set the material parameters. Acrylic panels and paint stencils have their own canvases. Projects with more than 100 canvases download as a ZIP of numbered Studio projects.</p>

  <h2>Open straight in Studio from Atomm</h2>
  <p>TopoStack also runs on <a href="https://www.atomm.com/creativetools/community/generator/topostack">Atomm</a>, xTool’s maker platform. There, Atomm’s Open in xTool Studio export sends the master SVG to Studio without a download. You need to be signed in to Atomm. Acrylic water inserts are cut from different stock, so they are not part of that master: download the project files for their own SVGs.</p>
  <p>To work from the individual SVGs in Complete project, use the import workflow below.</p>

  <h2>Choose the file for the job</h2>
  <ul>
    <li>For a layered relief, unzip the download and choose one wood panel or nested sheet SVG. The master SVG puts all panels together and may exceed your bed size.</li>
    <li>For a flat engraving, use the file ending in <code>-engraving.svg</code>.</li>
    <li>A panel SVG already includes its linework. Its <code>-engrave.svg</code> companion is for a separate engraving job. Processing both copies engraves the same detail twice.</li>
    <li>Acrylic inserts and airspace pieces use their own material and files. Keep them separate from wood panels.</li>
  </ul>
  <p>See <a href={`${base}/guides/export-files`}>export files and SVG structure</a> for filenames, paint stencils and the assembly guide.</p>

  <h2>Import and verify the size</h2>
  <p>In xTool Studio, create a project and use Upload in the left toolbar to choose the SVG; see <a href="https://support.xtool.com/article/2520">xTool’s import guide</a>. TopoStack SVGs state their width and height in millimeters, at 1:1 physical size.</p>
  <p>Select the imported artwork and compare its width and height with the panel, sheet or engraving size in TopoStack and the export README. With kerf applied, a panel can be slightly larger than its nominal size. If the size is off by a constant factor, check the SVG DPI in Studio’s import settings, which xTool says sets how large an SVG appears on the canvas, then import again. Do not rescale the artwork by eye.</p>

  <h2>Set the processing for each color</h2>
  <p>Studio does not read SVG group names such as <code>CUT</code>, <code>SCORE</code> and <code>ENGRAVE</code>. Select the shapes of each color and set their processing type. xTool describes <a href="https://support.xtool.com/article/565">Score, Engrave and Cut</a>: Score follows a shape’s outline, Engrave processes the area inside it, and Cut goes through the material. For Open in Studio, Atomm places blue strokes and blue fills in separate processing rows. Its handoff uses <a href="https://dev.atomm.com/docs/export/svg-color-spec">Atomm’s SVG color specification</a>.</p>
  <table>
    <thead><tr><th scope="col">TopoStack artwork</th><th scope="col">xTool Studio processing</th></tr></thead>
    <tbody>
      <tr><td>Red <code>#FE0002</code> outlines and holes</td><td>Cut, with your tested through-cut settings.</td></tr>
      <tr><td>Blue <code>#2366FF</code> contours, roads, labels and shorelines</td><td>Score. Engrave would fill every closed contour.</td></tr>
      <tr><td>Green <code>#00A651</code> assembly ids</td><td>Score for line lettering or Engrave for filled lettering. These ids help position split pieces.</td></tr>
      <tr><td>Black <code>#000000</code> filled lettering, symbols and graphics</td><td>Engrave. In an Atomm export these shapes use blue fill.</td></tr>
    </tbody>
  </table>
  <p>Dash gaps in trails, boundaries and coordinate grids are part of each path and survive import. Choose power, speed and passes for your machine and material. Mark detail before releasing pieces with the final cut.</p>

  <h2>Apply kerf compensation once</h2>
  <p>If TopoStack’s <strong>Laser kerf</strong> is nonzero, its wood cut paths already include compensation. Do not add an offset or kerf compensation in Studio as well. To use a tested offset in Studio instead, set TopoStack’s Laser kerf to zero and regenerate or refresh before exporting. Paint stencils are nominal-size artwork and should be cut without compensation. Acrylic has its own TopoStack kerf setting; check its README separately.</p>

  <h2>Preview, then follow the assembly guide</h2>
  <p>Use Studio’s preview and framing to confirm the processing order, outlines, holes and marked detail, and that the job fits your work area. Confirm there are no duplicate companion engravings and that no contour line has become a filled area. After cutting a layered project, open its <code>-assembly-guide.html</code> booklet and follow the numbered sheets and layers. If the map is too large for your bed, <a href={`${base}/guides/split-large-maps`}>split it in TopoStack</a> before exporting. If export is blocked, follow <a href={`${base}/guides/troubleshooting`}>troubleshooting</a>.</p>
  <p class="note">Checked in xTool Studio 1.8.22 on macOS on November 23, 2026. A 100 × 60 mm test panel imported at 3.937 × 2.362 inches with three color layers. The trail retained its dash gaps and the filled symbol retained its opening.</p>
</Article>
