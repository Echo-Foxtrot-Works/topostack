<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Map details, labels and linework" intro="Choose which roads, water and annotations appear on your map, place the north arrow and labels, and set line widths that suit your laser and material.">
  <h2>What you need</h2>
  <p>A project with a place and size chosen. Map features, labels and line widths update the preview without regenerating terrain, so you can experiment freely. Judge every change at your finished size: a detail that reads well on screen can be too fine to engrave.</p>

  <h2>1. Choose map features</h2>
  <p>In the <strong>Features</strong> panel, the switches under <strong>On the map</strong> turn on data from OpenStreetMap. A feature's width and style settings appear under its switch while it is on.</p>
  <ul>
    <li><strong>Roads</strong> and <strong>Trails</strong> (on by default).</li>
    <li><strong>Transportation labels</strong>: road and trail names, where they fit.</li>
    <li><strong>State / province boundaries</strong>, drawn dashed.</li>
    <li><strong>Latitude / longitude grid</strong>, drawn dotted.</li>
    <li><strong>Engraved border</strong> (flat only, on by default): an outline around the artwork.</li>
  </ul>
  <p>The <strong>Water</strong> panel holds <strong>Water outlines</strong> (on by default): lake, river and coast lines. In flat output, <strong>Water fill</strong> adds Lines, Ripples or Dots inside water; None keeps outlines only. Layered output adds <strong>Water depth</strong> there too (see <a href={`${base}/guides/how-lake-depths-work`}>how lake depths work</a>). <strong>Assembly guides</strong>, engraved outlines and layer numbers that show where each sheet sits, are under <strong>Assembly</strong> in the <strong>Fabricate</strong> panel.</p>
  <p class="note">Dense areas can reach the map detail limit, which leaves some features out or blocks export. Frame a smaller area or turn off details you do not need.</p>

  <h2>2. Add annotations</h2>
  <p>In the <strong>Labels</strong> panel, under <strong>Marks</strong>:</p>
  <ul>
    <li><strong>Elevation labels</strong> (on by default) engrave elevations on the terrain. <strong>Label X</strong> and <strong>Label Y</strong> set a preferred position as a percentage from the center (−90 to 90); TopoStack moves labels where needed to avoid other lines, and leaves out any that cannot fit.</li>
    <li><strong>North arrow</strong> (on by default) offers three designs, <strong>Minimal</strong>, <strong>Classic</strong> and <strong>Mariner</strong>, and a <strong>Diameter</strong> from 12 mm up to a limit set by your artwork size. Choose <strong>Move on preview</strong> to place it: the preview turns to look straight down on the finished piece and the north arrow floats above it, so you can drag it anywhere, or move it with the arrow keys (hold Shift for 10 mm steps). Drag the round corner handle, or press + and −, to change its <strong>Diameter</strong> there too. It always stays inside the material. <strong>Done</strong> engraves it where you left it, on whichever layers it lands; <strong>Cancel</strong> or Esc puts it back. <strong>Reset position</strong> returns it to the bottom-right corner.</li>
    <li><strong>Scale bar</strong> (on by default) is engraved on whichever sheets it crosses, so upper layers never hide it. Its length follows the map scale. <strong>Move on preview</strong> places it like the north arrow; <strong>Reset position</strong> returns it to its original spot.</li>
    <li><strong>Title</strong> (off by default) engraves up to three lines of text, such as a place name, a date and a route. It starts from the project name; <strong>Use project name</strong> restores it. Set the <strong>Letter height</strong> (3–30 mm), and a <strong>Title font</strong>, then use <strong>Move on preview</strong> to place and size it like the north arrow; lines align toward the nearest edge. Tab switches between the title and the north arrow while placing. <strong>Reset position</strong> returns it to the bottom-left corner. The title uses the label font unless you pick another; <strong>Same as labels</strong> goes back to it. Contours and map details under the text are cleared so it stays readable. The built-in fonts engrave capitals, letters, digits and common punctuation (<code>, . ' - / : &amp; # ( ) ! °</code>); the other fonts keep the case you type and include accented letters. A note lists any character the chosen font lacks, which would engrave as “?”. A title that does not fit the material is left out with a warning.</li>
  </ul>

  <h2>3. Set the text style</h2>
  <p>Under <strong>Text</strong> in the same panel, choose the <strong>Engraving font</strong> for map labels and a <strong>Text size</strong> from 2 to 10 mm. Text size is the height of capital letters in every font. Larger text is easier to engrave but has fewer places to fit. The fonts come in three kinds:</p>
  <ul>
    <li><strong>Built-in</strong>: <strong>Technical</strong>, <strong>Rounded</strong> and <strong>Stencil</strong> draw compact capitals from short strokes.</li>
    <li><strong>Single line</strong>: <strong>Hershey Sans</strong>, <strong>Hershey Serif</strong>, <strong>Hershey Script</strong> and <strong>Relief SingleLine</strong> are real letterforms drawn as one line, so the laser traces each letter once. They engrave quickly and stay crisp at small sizes. The Hershey fonts cover Western European accents; Relief SingleLine also covers Central European letters such as ł and č.</li>
    <li><strong>Filled</strong>: <strong>Jost</strong>, <strong>Oswald</strong>, <strong>Lora</strong> and <strong>Roboto Slab</strong> are ordinary typefaces whose letters are closed shapes. Set the engrave layer to fill (or raster) in your laser software; engraved as lines, only their outlines are traced. They read best at 4 mm and above.</li>
  </ul>

  <h2>4. Tune the linework</h2>
  <p>At the top of the <strong>Features</strong> panel, <strong>Line weight</strong> offers three presets. Each sets every line width in the project, including water, aviation and label lines:</p>
  <ul>
    <li><strong>Fine</strong>: thinner lines and dotted trails, for dense detail or large pieces.</li>
    <li><strong>Balanced</strong> (default): a clear hierarchy with dashed trails.</li>
    <li><strong>Bold</strong>: thicker lines for strong contrast or small pieces.</li>
  </ul>
  <p>To fine-tune one line, adjust its width where the feature lives, each from 0.05 to 1.5 mm. Changing a width marks the preset as custom; picking a preset again resets every line.</p>
  <ul>
    <li><strong>Terrain</strong> panel (flat only): <strong>Minor contours</strong> and <strong>Index contours</strong>.</li>
    <li><strong>Features</strong> panel, under each switch: <strong>Major roads</strong> and <strong>Local roads</strong>, and a <strong>Width</strong> for trails, boundaries, the grid and the border.</li>
    <li><strong>Road appearance</strong>, under <strong>Roads</strong>: <strong>Centerline</strong>, or <strong>Outlined</strong> major roads drawn as two parallel lines with an <strong>Outline spacing</strong> of 0.2–4 mm; <strong>Round</strong> or <strong>Square</strong> road ends.</li>
    <li><strong>Trail pattern</strong>, under <strong>Trails</strong>: <strong>Solid</strong>, <strong>Dashed</strong> or <strong>Dotted</strong>.</li>
    <li><strong>Water</strong> panel: a <strong>Width</strong> under <strong>Water outlines</strong>.</li>
    <li><strong>Labels</strong> panel: <strong>Label and guide lines</strong>, for text, the north arrow, markers and assembly guides.</li>
  </ul>
  <p>Widths are physical stroke widths in the SVG. The width your laser actually burns also depends on focus, power, speed, material, and whether your software engraves strokes as lines or as filled shapes.</p>

  <h2>Check before you engrave</h2>
  <p class="note">Zoom into the Cut layers or Engraving preview at your finished size. Look for labels crowding contours, fills competing with the terrain, and lines too close to separate on your material. Test your narrowest line width on scrap.</p>

  <h2>Next steps</h2>
  <p>Add your own points and routes with <a href={`${base}/guides/custom-markers-and-paths`}>custom markers and paths</a>, or look up any control in the <a href={`${base}/guides/settings-reference`}>settings reference</a>.</p>
</Article>
