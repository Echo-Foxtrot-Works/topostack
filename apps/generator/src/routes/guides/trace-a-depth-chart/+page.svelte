<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  const base = basePath();
</script>

<Article title="Carve a lake from a depth chart" intro="Turn a published lake chart into a floor for your layered map. Prepare its contour lines, correct them against the source, align them with known coordinates, then inspect the generated layers before saving.">
  <h2>Choose a chart this version supports</h2>
  <p>Use a flat, geographically referenced chart of one lake, with a complete shoreline and closed, noncrossing depth contours. Islands and underwater rises are supported when explicitly defined. Incomplete contour networks and photographs distorted by perspective are not supported. A scan, screenshot, or vector PDF is a better starting point.</p>
  <ul>
    <li>PNG, JPEG, WebP or PDF, with readable contours and printed values.</li>
    <li>The units and readable values for every included depth contour. If the numbers are elevations, also the chart's water-surface elevation.</li>
    <li>At least four known geographic positions spread around the chart, with both longitude and latitude in WGS84 decimal degrees.</li>
    <li>The complete outer shoreline and any island boundaries. No seed points or uniform contour interval are required.</li>
  </ul>
  <p>Keep coordinate ticks or grid intersections needed for alignment when cropping. A printed tick showing only latitude or longitude is not a complete control point by itself. If the chart uses another coordinate system, convert its coordinates to WGS84 before entering them.</p>
  <p>Check the <a href={`${base}/guides/lake-depth-data`}>surveyed-depth directory</a> first. Charts are for layered output: flat engraving has no lake floor to carve. Preparing a chart does not require terrain generation or move your project's map area.</p>

  <h2>1. Choose the lake and upload the source</h2>
  <p>Open <strong>Custom data</strong>, then <strong>Depth charts</strong>. Search for the lake or a nearby town and select the matching result, or click its outline on the map. Small lakes listed as “Lake from the map” can also use a chart.</p>
  <p>Upload the picture or PDF and, for a multipage PDF, choose the chart page. Pictures are reduced to 2,400 pixels on their longer side. Leave out unrelated page furniture when possible, but retain the full shoreline and the coordinates needed for alignment. If a PDF renders blank, export its chart page as a picture.</p>

  <p>Both the source chart and contour-repair editor use the same zoom controls as the flat and cut-layer views. Scroll over the chart or pinch to zoom around a detail, drag to pan, and use the plus/minus buttons or keys for steps. The reset button or 0 returns to the fitted view. A drag moves the view without placing a depth or editing a path.</p>

  <h2>2. Set units and prepare contours</h2>
  <p>Set <strong>Depths are in</strong> to the printed units. Choose <strong>Depth below the surface</strong> or <strong>Height above a datum</strong>; elevations also require <strong>Surface level</strong> in the same units. Each contour gets its own printed value during review; irregular intervals are supported.</p>
  <p>For a vector PDF, expand <strong>Use native PDF lines (recommended)</strong> and select the line styles containing the shoreline and underwater contours. Leave unrelated styles unchecked. If that control is absent, or the PDF is a scanned picture, use image tracing.</p>
  <p>Select <strong>Prepare contours for review</strong> in the sidebar. This creates editable path proposals directly from the image or selected PDF lines. It does not create a depth grid or approve their accuracy.</p>

  <h2>3. Review and correct every included path</h2>
  <p>The chart fills the left side while repair tools replace the previews on the right. Use <strong>Contours</strong>, <strong>Alignment</strong>, and <strong>Checks</strong> to switch tools; scrolling the tools keeps the chart in place. On narrow screens the tools sit below the chart. Compare the colored paths with the source underneath. Select a path on the picture or in the contour chooser. Set its <strong>Contour printed value</strong>, then use <strong>Confirm path and value</strong>. Select the actual water boundary and choose <strong>Use as shoreline</strong>, then confirm it too.</p>
  <ul>
    <li>Use <strong>Exclude stray path</strong> for text, borders, legend fragments, and above-water contours. Excluding a genuine underwater contour can distort the basin.</li>
    <li>Select an open fragment and choose <strong>Join paths</strong>, then click or tap the next fragment on the chart. The source stays purple; hovering or focusing a target previews it and the proposed endpoint connection in cyan. Escape or <strong>Cancel joining</strong> leaves both paths unchanged. A join can be undone with <strong>Undo edit</strong>. Use <strong>Close path</strong> for a legitimate remaining gap and check the connection against the printed line before confirming.</li>
    <li>Use <strong>Redraw selected path</strong> or <strong>Draw new contour</strong> when the source line was missed. Individual vertices can also be corrected.</li>
    <li><strong>Undo edit</strong> and <strong>Redo edit</strong> belong to this contour editor. A changed path needs confirmation again.</li>
  </ul>
  <p>Follow the reported issues to unresolved paths. Included contours must be closed, inside the shoreline, noncrossing, and consistent with their local contour relationships. Do not dismiss a real contour simply to clear a warning.</p>
  <figure>
    <a href={`${base}/images/guides/chart-contour-editing.png`} aria-label="Open the King City contour repair workspace at full size"><img src={`${base}/images/guides/chart-contour-editing.png`} width="1600" height="1100" loading="lazy" decoding="async" alt="Large King City South source chart on the left, with contour selection, repair controls, and generation status in the right panel." /></a>
    <figcaption>King City South in contour editing mode. The chart stays visible while the right panel holds repair tools and a fixed generation button. This example imported a prepared review draft and still needs alignment confirmation; it is not an automatic tracing result. Open the image for detail.</figcaption>
  </figure>

  <h2>Islands, underwater rises, and basin bottoms</h2>
  <p>Set the selected path's type to outer shoreline, island boundary, or depth contour. Island boundaries sit at the water surface; their interiors remain land in both the depth grid and terrain carving. Do not assign underwater values to island boundaries. A contour inside island land must be excluded or corrected.</p>
  <p>For a depth contour, choose whether its interior is deeper (a basin) or shallower (an underwater rise). A rise needs a surrounding deeper contour. Multiple basins and rises can coexist; the checks compare each contour with its immediate surrounding path instead of requiring every nested line to get deeper.</p>
  <p>Beyond an innermost contour, the default is to hold that contour's value. Expand the interior controls to enter a known or deliberately modelled bottom or summit in the same printed units. That value shapes a smooth interior; its exact location is not surveyed. Leave it blank when the source does not justify an extra assumption. Values on non-innermost contours are blocked because enclosed paths already define that region.</p>
  <p>Boundaries must remain separate: touching or crossing paths need repair. Narrow channels and small islands still need inspection at the final grid and fabrication scale.</p>

  <h2>4. Align the chart with known coordinates</h2>
  <p>Open <strong>Alignment</strong> in the tools panel. Select <strong>Place alignment point</strong>, click a known position on the source, then enter its longitude and latitude. Repeat at least four times, spread around the lake rather than clustered in one corner. Use negative longitude west of Greenwich and negative latitude south of the equator.</p>
  <p>Check the dashed pink map outline against the blue source shoreline, and verify which end of the lake is north. The app checks coordinate fit and shoreline overlap. If alignment fails, check the points, coordinate system, source crop, and lake selection. A low residual alone does not prove the coordinates are correct.</p>
  <p>Once the overlay agrees with the source, check the alignment confirmation. The app will not generate depths until alignment and all contour issues are resolved.</p>

  <h2>5. Generate depths and inspect their appearance</h2>
  <p>Select <strong>Generate reviewed depths</strong>. The right panel switches to the 3D and depth-map previews. <strong>Edit contours</strong> returns to the repair tools without losing zoom or undo history; <strong>View generated depths</strong> returns to the current result if you have not changed the chart. Compare the deepest part, shallow shelves, channels, and basin orientation with the chart. Use the representative stack to inspect the stepped shape and the shaded depth view to inspect the continuous floor.</p>
  <p>The chart's representative preview is independent of your project settings. Its sheet count and exaggeration do not predict your finished cut layers. Check the actual project's layers after applying the chart, especially where small islands of material or narrow bridges may form.</p>
  <p>Changing a contour, its value, or alignment invalidates the generated result and layer approval. Resolve the issues and generate again. <strong>Prepare contours again</strong> replaces manual edits with new proposals; export a draft first if you want to keep them.</p>

  <h2>6. Keep, apply, and regenerate</h2>
  <p>Select <strong>Review and save chart</strong>. Name the chart, identify its source, and confirm that you checked the generated basin and layers against the original. Only then is <strong>Keep this chart</strong> available.</p>
  <p>Keeping a chart adds it to <strong>Your charts</strong>. Select <strong>Use for</strong> beside the lake's name, return to your map, and select <strong>Regenerate terrain</strong>. Step through <strong>Cut layers</strong> at the final material thickness and output size.</p>
  <figure>
    <a href={`${base}/images/guides/chart-generated-terrain.png`} aria-label="Open the generated King City terrain screenshot at full size"><img src={`${base}/images/guides/chart-generated-terrain.png`} width="1600" height="1100" loading="lazy" decoding="async" alt="King City South terrain with six stacked layers and warnings about incomplete chart coverage and little elevation change." /></a>
    <figcaption>The reviewed chart applied to real terrain: six layers and six cut panels in this project. The incomplete-coverage warning remains visible. The chart shoreline and map shoreline differ, so edge areas still need visual inspection before cutting.</figcaption>
  </figure>
  <p>Where chart coverage is missing, existing terrain, modeled depths, or estimates near surveyed shores may fill the gap; cells without enough information remain at the waterline. Read coverage warnings and inspect those transitions. <strong>Stop using</strong> in the chart library restores the lake's other depth sources after regeneration.</p>

  <h2>Save unfinished work and move between computers</h2>
  <p><strong>Export review draft</strong> saves editable contour work. Keep the original image or PDF separately: a draft does not contain it. After closing or reloading, upload that same file and page, then use <strong>Restore contour review draft</strong>. Recheck alignment, generate depths again, and repeat layer approval. Switching studio views preserves the in-progress draft; closing or reloading the page does not.</p>
  <p>Kept charts live in this browser. Exported <strong>Project settings</strong> include the charts used by the project and their review status, so they can travel to another computer. Share links do not carry chart data. Original pictures are not included in kept charts or project exports.</p>
  <p>Charts saved before contour review was introduced remain available for export and recovery, but cannot be applied to new generations. Recreate them from their original sources through the review workflow.</p>

  <h2>Before you cut</h2>
  <p class="note">Review confirms that you checked the chart; it does not certify surveyed accuracy or physical cutability. Inspect the final cut layers, shoreline transitions, and small features. Test a representative cut and assembly with your material and kerf settings before committing the whole stack.</p>
  <p>For the reasoning behind these steps, read <a href={`${base}/guides/how-depth-chart-tracing-works`}>how depth-chart tracing works</a>. Continue with the <a href={`${base}/guides/custom-lake-depth-map`}>custom lake depth map guide</a> to finish the project.</p>
  <p class="note">Images: TopoStack using the public-domain <a href="https://pubs.usgs.gov/sim/3486/sim3486_sheet02.pdf">USGS King City South chart</a>. Map data © OpenStreetMap contributors. These are software validation captures, not photographs of a fabricated map.</p>
</Article>
