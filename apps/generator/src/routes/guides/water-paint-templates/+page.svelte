<script lang="ts">
  import WaterFinishComparison from "$lib/site/WaterFinishComparison.svelte";
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Paint lakes with water paint templates" intro="Color the water on a layered relief without masking by hand. TopoStack cuts a paper stencil for each panel, open exactly where the lake stays visible once the stack is glued.">
  <h2>Choose your water finish</h2>
  <WaterFinishComparison />

  <h2>Turn on paint templates</h2>
  <p>Choose <strong>Layered</strong> and turn on <strong>Water paint templates</strong> in <strong>Fabrication settings</strong>, then regenerate terrain. For every panel with water that stays visible once the stack is glued, TopoStack writes a paper stencil registered to that panel. Mask the land with it and spray the water, and the paint lands exactly where the lake will show. Water outlines are fetched for the templates even when <strong>Water outlines</strong> and <strong>Water depth</strong> are off.</p>
  <figure>
    <img src={`${base}/images/guides/paint-template-on.webp`} width="1600" height="1100" loading="lazy" decoding="async" alt="Cut layers view of a Crater Lake layer with the Paint template switch on: the land is covered by a pale stencil and only the lake is left open, outlined in red." />
    <figcaption>Layer 22 of a Crater Lake relief with <strong>Paint template</strong> on. The pale stencil covers the land; the lake is cut away. Survey data where available; depth exaggerated.</figcaption>
  </figure>

  <h2>Preview a stencil</h2>
  <p>In the <strong>Cut layers</strong> view, use the <strong>Paint template</strong> switch in the lower right corner to lay the stencil over the current layer. Step through the layers with the slider: each one has its own window, including the deeper steps of a lake basin. On a layer with no visible water the switch reads <em>No paint template on this layer</em>.</p>
  <figure>
    <img src={`${base}/images/guides/paint-template-lower-layer.webp`} width="1600" height="1100" loading="lazy" decoding="async" alt="Paint template preview of a lower layer, where the stencil window follows a smaller, deeper step of the Crater Lake basin." />
    <figcaption>A lower layer's stencil opens only the part of the lake floor that remains visible above it.</figcaption>
  </figure>

  <h2>What the stencil covers</h2>
  <ul>
    <li>Each stencil is the cut piece at its nominal size with the visible water cut away, as one outline. The window reaches 1.5 mm under the layer above, so a slightly misplaced stencil leaves no bare edge at the foot of the step. Where water meets the piece edge the stencil stops short of that edge, so register it on the edges and tabs it keeps; a piece painted edge to edge needs no stencil and gets none.</li>
    <li>Where water meets the edge of the piece, the stencil stops short of that edge. Line it up on the edges and puzzle tabs it keeps.</li>
    <li>Paper strips narrower than the <strong>Minimum feature</strong> are opened up rather than left as fragile bridges.</li>
  </ul>

  <h2>Export and use the stencils</h2>
  <p>Open <strong>Individual files</strong> in Export and choose <strong>Paint templates</strong> for the stencils alone, or <strong>Complete project</strong> for everything. Each stencil is named after its panel with <code>-paint-water</code> added, such as <code>my-map-layer-03-b2-paint-water.svg</code>, and shares the panel's canvas, so the two line up when imported together.</p>
  <ol>
    <li>Cut the stencils from paper or stencil film. Every stencil path is a red cut. <strong>Turn off kerf compensation</strong> in your laser software for these files: the stencil must match the piece at its nominal size.</li>
    <li>Lay each stencil flush on its cut piece, registering on the outer edges and tabs.</li>
    <li>Spray the water and remove the stencil before gluing.</li>
    <li>The 1.5 mm bleed lands on glue area that the next layer covers. If the paint film there is thick, wipe or lightly sand it so the layer above sits flat.</li>
  </ol>

  <h2>With a split map</h2>
  <p>When a <a href={`${base}/guides/split-large-maps`}>work area splits the layers</a>, each piece that shows water gets its own stencil, named after its cell. Register it on the piece's puzzle tabs as well as its outer edges.</p>

  <h2>With acrylic water inserts</h2>
  <p>With <strong>Acrylic water inserts</strong> on, each lake on the sheet at its waterline becomes clear acrylic, so that sheet has no water left to paint. The lake bed below still gets its stencils: paint it before gluing and the colour shows through the acrylic. The 2 mm ledge the insert rests on is part of the bed's stencil window too.</p>
  <h2>Check before you cut</h2>
  <p class="note">Cut one stencil and test it on a scrap of your material and paint before committing the whole stack. Kerf compensation must be off for the stencil files.</p>
  <h2>Related guides</h2>
  <p>Follow the <a href={`${base}/guides/laser-cut-topographic-map`}>layered map guide</a> for the full workflow, read <a href={`${base}/guides/how-lake-depths-work`}>how lake depths work</a> for the layers a lake floor becomes, and see <a href={`${base}/guides/export-files`}>export files</a> for every file name.</p>
</Article>
