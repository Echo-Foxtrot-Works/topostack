<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
  import ExampleActions from "$lib/site/ExampleActions.svelte";
  import { exampleStudioPath } from "$lib/site/site";
</script>

<Article title="Explore a Crater Lake topographic map" intro="Start with the landscape already waiting in TopoStack. The Crater Lake preview shows how real elevation and map details become a layered terrain project.">
  <figure>
    <picture><source type="image/webp" srcset={`${base}/images/studio-crater-lake-640.webp 640w, ${base}/images/studio-crater-lake.webp 1280w`} sizes="(max-width: 720px) 100vw, 1280px" /><img src={`${base}/images/studio-crater-lake.png`} width="1280" height="900" alt="Freshly generated Crater Lake relief in TopoStack with USGS surveyed lake-floor bathymetry." /></picture>
    <figcaption>Freshly generated Crater Lake relief with USGS surveyed lake-floor data where available. Gaps use existing terrain or modeled depths; depth is exaggerated.</figcaption>
  </figure>
  <ExampleActions slug="crater-lake" />
  <h2>What you need</h2>
  <p>A browser with an internet connection. To make the piece, add 3.175 mm (1/8 in) sheet material and laser software that can import SVG files.</p>
  <h2>Recreate the pictured project</h2>
  <ol>
    <li><a href={`${base}${exampleStudioPath("crater-lake")}`}>Open Crater Lake in the studio</a>. It opens the Crater Lake starting project and generates its terrain. If you had another project open, <strong>Undo</strong> returns to it.</li>
    <li>Select <strong>Layered</strong>. In the <strong>Place</strong> panel, choose a rectangle 406.4 mm wide by 270.933 mm high (16 × 10.667 in). In the <strong>Terrain</strong> panel, enter 3.175 mm sheet material.</li>
    <li>Set <strong>Vertical exaggeration</strong> to 4×. The studio rounds the relief to whole material layers without an upper layer limit. The pictured project uses 24 layers; different framing, thickness or data can change the count.</li>
    <li>In the <strong>Water</strong> panel, keep <strong>Water depth</strong> on, set <strong>Depth exaggeration</strong> to 1.75× and leave <strong>Limit depth layers</strong> off for automatic coverage. Choose roads and other details in the <strong>Features</strong> panel, then select <strong>Generate terrain</strong>.</li>
    <li>Inspect the layers and the exploded 3D view, then open <strong>Export</strong>, download the complete project and read its assembly guide.</li>
  </ol>
  <p>Your result can differ from the picture. The starting project is centered on the caldera but is not the exact pictured map area, so check the output type, size, material thickness and map details against the steps above. Different framing, fresh data or different settings change the layer and panel counts.</p>
  <h2>Understand the lake</h2>
  <p>The surrounding terrain uses real elevation data. With water depth on, Crater Lake uses the integrated USGS lake-floor survey where available; uncovered areas use existing terrain or modeled depths. The <a href={`${base}/guides/lake-depth-data`}>lake depth directory</a> lists every integrated survey.</p>
  <p>Automatic depth coverage adds the sheets needed for the requested depth without reducing land relief. If you enable <strong>Limit depth layers</strong>, fitting compresses lakes into that allowance. <strong>Use manual depth</strong> turns fitting off; with a limit still enabled, deeper floors can be flattened. Turn the limit off to return to automatic coverage. <a href={`${base}/guides/how-lake-depths-work#layers`}>Learn how depth settings affect layers</a>.</p>
  <h2>Try the same place as an engraving</h2>
  <p>Switch to <strong>Flat</strong> for a single surface. Adjust contour density and index lines, choose the details you want, then generate and inspect the flat preview. Follow the <a href={`${base}/guides/topographic-map-engraving`}>engraving guide</a> for the SVG output and import checks.</p>
  <h2>Next steps</h2>
  <p>Download the project-settings JSON as a record of your chosen area and controls, and keep <strong>ATTRIBUTION.txt</strong> and the README with the artwork. Follow the <a href={`${base}/guides/laser-cut-topographic-map`}>layered map guide</a> to import, cut and assemble the pieces.</p>
</Article>
