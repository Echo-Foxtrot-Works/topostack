<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Split a large map to fit your laser bed" intro="Build a layered relief bigger than your machine. TopoStack splits every layer into pieces that fit your work area, staggers the seams between layers and keys hidden joints with puzzle tabs.">
  <figure>
    <img src={`${base}/images/guides/split-relief.webp`} width="1600" height="1100" loading="lazy" decoding="async" alt="TopoStack studio showing a 406 by 271 mm Crater Lake relief in the 3D stack view, with a 220 by 160 mm work area set." />
    <figcaption>A 406.4 × 270.9 mm Crater Lake relief with a 220 × 160 mm work area: two by two sheets per layer. Survey data where available; depth exaggerated.</figcaption>
  </figure>

  <h2>Set your work area</h2>
  <p>In the <strong>Fabricate</strong> panel, enter your machine's <strong>Work area width</strong> and <strong>Work area height</strong>. Both are 0 (off) by default; 0 on one axis leaves that axis unlimited. Below the fields, the studio reports the result, such as <em>2 × 2 sheets per layer · 203.2 × 135.466 mm tiles</em>. Regenerate terrain to apply it. Once a layer is split, the seam options below appear under <strong>Panels and seams</strong> in the export dialog.</p>
  <p>TopoStack divides each layer along a grid of seams into equal tiles that fit the bed, and exports one panel SVG per tile. Every layer gets the same number of tiles. A flat engraving is never split.</p>
  <figure>
    <img src={`${base}/images/guides/split-cut-layer.webp`} width="1600" height="1100" loading="lazy" decoding="async" alt="Cut layers view of layer 22 split into four pieces, with red seam lines, small round puzzle tabs along the seams and engraved assembly ids such as L22-A1." />
    <figcaption>Layer 22 in the Cut layers view: seams in red, puzzle tabs where the next layer covers the seam, and each piece's assembly id.</figcaption>
  </figure>

  <h2>Staggered seams</h2>
  <p>Alternating layers shift their seams by the <strong>Seam offset</strong> (10 mm by default, 0–50 mm) on both axes. A seam then always sits over solid material in the layers above and below, so the glued stack has no straight crack running through it. With an offset of 0 the seams line up on every layer; back them with a glue strip or a sub-base.</p>
  <p>The tiles at each end grow by half the offset to make room for the shift. A model that only just overflows the bed may therefore need one more division than you expect.</p>

  <h2>Puzzle seam tabs</h2>
  <p>Where a seam runs under the next layer, it is cut as small interlocking jigsaw tabs, 5 mm deep (4 mm where there is less room). Each piece only fits its true neighbour and locks into line with it; press the tabs home before gluing. Seams that stay visible, on the top layer or an exposed slope, are cut straight. Turn off <strong>Puzzle seam tabs</strong> for straight seams everywhere.</p>

  <h2>Assembly ids and file names</h2>
  <p>With <strong>Assembly labels</strong> on, each piece engraves its id, such as <code>L03-B2</code> for layer 03, column B, row 2, on a spot the next layer covers. The ids sit in a separate green (<code>#00A651</code>) <code>ASSEMBLY</code> group, so you can assign that color to Score or skip it. Panel files use the same cell name: <code>my-map-layer-03-b2.svg</code>.</p>
  <p>A piece that already fits the bed is never cut just because a seam crosses it. If it reaches past its tile and won't fit beside the tile's other pieces, it ships on its own sheet with a sheet number, as in <code>-b2-2</code>.</p>

  <h2>Kerf, nests and limits</h2>
  <ul>
    <li>Seam edges get the same kerf compensation as every other cut, so pieces butt together at their intended size.</li>
    <li>Splitting usually replaces <strong>Material-saving nests</strong>, because a nested piece must fit inside a single tile.</li>
    <li>The grid stops at 12 divisions per axis; a warning names any piece still larger than the bed. A split that would make more than 400 pieces across the stack is skipped with a warning. Use a larger work area, a smaller model or thicker material for fewer layers.</li>
  </ul>

  <h2>Check before you cut</h2>
  <p class="note">Enter the usable bed size from your laser software, not the machine's nominal size. Cut one split layer as a test before committing the whole stack.</p>
  <h2>Related guides</h2>
  <p>Paint the lakes with <a href={`${base}/guides/water-paint-templates`}>water paint templates</a>, which follow the same pieces. Follow the <a href={`${base}/guides/laser-cut-topographic-map`}>layered map guide</a> for the full workflow, see <a href={`${base}/guides/export-files`}>export files</a> for every file name, and check <a href={`${base}/guides/settings-reference`}>the settings reference</a> for ranges and defaults.</p>
  <p>For how artwork size affects layer count and how the browser handles larger stacks, read <a href={base + "/guides/how-terrain-generation-works"}>how terrain generation works</a>.</p>
</Article>
