<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="How to make a laser-cut topographic map" intro="Turn a mountain, lake or familiar landscape into a layered relief. TopoStack converts real elevation data into SVG cut panels, engraving companions and an assembly guide.">
  <h2>What you need</h2>
  <p>A browser with an internet connection, sheet material of a known thickness, and laser software that can import SVG files. TopoStack is free to use and needs no account. It prepares artwork; you choose the machine settings for your material.</p>
  <h2>1. Choose and frame your landscape</h2>
  <p><a href={`${base}/studio`}>Open the terrain studio</a> and select <strong>Layered</strong>. Choose a place by search, coordinates or a location preset, then use the map to frame the area. Start with a recognizable feature rather than a very large region so its contours remain readable at the finished size.</p>
  <p>A new browser opens with a bundled Crater Lake preview. You can explore it immediately, but you must generate fresh terrain before exporting fabrication artwork.</p>
  <h2>2. Set the physical size and material thickness</h2>
  <p>In the <strong>Place</strong> panel, choose a rectangle or circle, then enter the finished width (and height, for a rectangle). In the <strong>Terrain</strong> panel, enter your measured sheet thickness. The studio can show metric or imperial units; the SVG files always use millimeters.</p>
  <p>Layer count is calculated from the landscape's elevation range, map scale, vertical exaggeration and material thickness, with no upper sheet cap. Adjust the exaggeration to change the relief; a thicker sheet needs fewer layers for the same model height. Automatic lake depth adds the required sheets below the land without reducing land exaggeration. An optional depth-layer limit controls that allowance. Read the resulting count in the studio; it is not a separate setting.</p>
  <h2>3. Choose the map details</h2>
  <p>Use the <strong>Features</strong>, <strong>Water</strong> and <strong>Labels</strong> panels to add roads, trails, water, labels, a compass or a scale bar as useful context. Preview the fine details at the size you intend to make. Features that look attractive on screen may be too small for your material or laser.</p>
  <p><strong>Water depth</strong>, in the <strong>Water</strong> panel, is on by default. Search the <a href={`${base}/guides/lake-depth-data`}>lake depth directory</a> for lakes with surveyed depth data. Elsewhere, TopoStack can model depths from lake data and the surrounding terrain; see <a href={`${base}/guides/how-lake-depths-work`}>how lake depths work</a>.</p>
  <h2>4. Generate and inspect</h2>
  <p>Select <strong>Generate terrain</strong>. After the first generation, the same button reads <strong>Regenerate terrain</strong>. Inspect the cut layers and the stacked or exploded 3D preview.</p>
  <p>Resolve messages that block export, such as stale settings, missing data or empty layers. Read the other warnings too: for example, labels that could not fit safely are left out.</p>
  <h2>5. Export and import the artwork</h2>
  <p>Open <strong>Export</strong> and download the complete project. It contains a master SVG, cut panels, matching engraving panels, an assembly guide, a project file with your settings and generation details, and <strong>ATTRIBUTION.txt</strong>.</p>
  <p>SVG operation groups separate cuts (red, <code>#FE0002</code>) from scores and engravings (both blue, <code>#2366FF</code>). In your laser software, confirm the imported dimensions and assign each operation deliberately: color alone does not configure the machine.</p>
  <p><strong>Kerf compensation is on by default.</strong> TopoStack moves each cut outward or inward by half the <strong>Laser kerf</strong> width set in the <strong>Fabricate</strong> panel (0.15 mm unless you change it). Measure your laser's kerf and enter it there, or set it to 0 if your laser software applies its own offset. Do not apply both.</p>
  <p>If the model is bigger than your laser bed, enter your machine's <strong>Work area width</strong> and <strong>Work area height</strong> in the <strong>Fabricate</strong> panel. TopoStack splits each layer into tiles that fit, shifts the seams on alternating layers so they never line up, and cuts hidden seams as interlocking puzzle tabs. Each piece engraves an id such as <code>L03-B2</code> on a spot the next layer covers. Splitting usually replaces material-saving nests, because a nested piece must fit inside a single tile. See <a href={`${base}/guides/split-large-maps`}>split large maps</a> for the details. To color the lakes, <a href={`${base}/guides/water-paint-templates`}>water paint templates</a> cut a paper stencil for each panel.</p>
  <h2>6. Keep the pieces and follow the assembly guide</h2>
  <p><strong>Material-saving nests</strong> (on by default) cut some upper layers from the part of a lower sheet that the layer above will cover, leaving a <strong>Glue margin</strong> around them. Both are under <strong>Panels and seams</strong> in the export dialog. Keep every loose cutout and use the layer IDs and assembly guide to identify where it belongs. Alignment engravings help position the next layer and are hidden once it is glued in place.</p>
  <h2>Check before you cut</h2>
  <p class="note">Confirm the imported size, the operation assigned to each color and your kerf setting. Test your material and machine settings on a small sample before committing a full sheet.</p>
  <h2>Next steps</h2>
  <p>For a single engraved surface, use the <a href={`${base}/guides/topographic-map-engraving`}>flat engraving guide</a>. For a ready-made starting point, follow the <a href={`${base}/examples/crater-lake`}>Crater Lake example</a>.</p>
</Article>
