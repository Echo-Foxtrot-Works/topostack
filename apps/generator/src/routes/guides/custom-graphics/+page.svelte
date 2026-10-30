<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  const base = basePath();
</script>

<Article title="Add your own graphics to a topographic map" intro="Put a logo, a club badge or a decoration on the piece itself. Upload an SVG once, then place, size and turn it on the preview, and choose whether the laser engraves it, scores its outline or cuts it out.">
  <h2>1. Upload a graphic</h2>
  <ol>
    <li>Open the <strong>Custom data</strong> view, then open <strong>Graphics</strong>.</li>
    <li>Select <strong>Upload SVG</strong> and choose an SVG file (up to 1 MB). It joins the project's library under its file name; type over the name to change it.</li>
  </ol>
  <p>Graphics are read the same way as <a href={`${base}/guides/custom-markers-and-paths`}>marker icons</a>: filled shapes keep their holes, strokes become outlines at their drawn width, and white paint is left out of the shape beneath it. Text, embedded images, clipping paths and masks are skipped, and the status line says when something was. Convert text to outlines before uploading.</p>

  <h2>2. Place it on the piece</h2>
  <p>Select <strong>Place</strong> beside a graphic, or <strong>Place graphics</strong> on the 3D stack. The preview turns to look straight down on the piece and the graphic appears in the middle, about a quarter as wide as the piece's shorter side.</p>
  <ul>
    <li>Drag it to move it, or use the arrow keys; hold Shift for 10 mm steps.</li>
    <li>Drag the corner grip, or press <kbd>+</kbd> and <kbd>−</kbd>, to resize it.</li>
    <li>Drag the grip above it to turn it, holding Shift to snap to 15°. <kbd>[</kbd> and <kbd>]</kbd> turn it 15° at a time, and <kbd>{"{"}</kbd> and <kbd>}</kbd> one degree.</li>
    <li>Choose <strong>Add graphic…</strong> in the toolbar to place another, including a second copy of the same one. <kbd>Delete</kbd> or the bin button takes the selected graphic off the piece.</li>
  </ul>
  <p>Select <strong>Done</strong> to keep every change as one step that <strong>Undo</strong> reverses, or <strong>Cancel</strong> to leave the piece as it was. A graphic keeps its place on the piece when you move the map or change the output size.</p>

  <h2>3. Choose what the laser does</h2>
  <p>Pick <strong>Engrave</strong>, <strong>Score</strong> or <strong>Cut</strong> for each placed graphic, in the placement toolbar or under <strong>On the piece</strong> in the sidebar.</p>
  <ul>
    <li><strong>Engrave</strong> fills the shape, and clears map lines for about 1.2 mm around it so it reads cleanly. Markers are still engraved on top of it.</li>
    <li><strong>Score</strong> traces only its outlines, in the score colour of your export.</li>
    <li><strong>Cut</strong> removes the shape from the sheet it sits on, so the sheet below shows through. The opening appears on the preview once you select <strong>Done</strong>.</li>
  </ul>
  <p>On a layered map, a graphic lands on whichever sheet shows at each point, so one that spans a contour is split across the sheets it covers. Islands inside a cut shape, such as the middle of an O, stay as small pieces to glue back onto the sheet below. A cut through the bottom sheet, or through a flat engraving, has nothing under it, so its islands fall out; the preview warns when that happens.</p>

  <h2>Tips</h2>
  <ul>
    <li>A graphic that does not fit inside the piece is left out with a warning. Make it smaller or move it inward.</li>
    <li>Keep detail coarser than your laser can draw. Cut shapes need gaps and bridges at least as wide as your minimum feature size.</li>
    <li>Removing a graphic from the library also removes every place it was used.</li>
  </ul>

  <h2>Limits</h2>
  <ul>
    <li>Up to 24 graphics in a project's library, and 50 placed on the piece.</li>
    <li>Detailed graphics are simplified to 3,000 points each. Projects with large graphics may be too big to share as a link; export the project file instead.</li>
    <li>Sizes from 3 mm up to the piece's shorter side, less a small margin.</li>
  </ul>
</Article>
