<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  const base = basePath();
</script>

<Article title="How depth-chart tracing works" intro="A contour chart records some of a lake's shape, but leaves the spaces between its lines unknown. TopoStack turns reviewed contours into a continuous lake floor, then turns that floor into layers. Each step makes choices that affect the finished piece.">
  <p>For the controls and step-by-step instructions, follow <a href={`${base}/guides/trace-a-depth-chart`}>carve a lake from a depth chart</a>. This guide explains what the system calculates, why manual review is required, and where we want to improve it.</p>

  <h2>From printed lines to a lake floor</h2>
  <ol>
    <li>Prepare editable paths from native PDF lines or image pixels.</li>
    <li>Check every included path, enter its printed value, and identify the shoreline.</li>
    <li>Align the chart to geographic coordinates using known points.</li>
    <li>Calculate depths between the reviewed contours inside the source shoreline.</li>
    <li>Review the basin, apply it to terrain, and inspect the project's final cut layers.</li>
  </ol>
  <p>The uploaded picture stays in your browser. A kept chart stores derived contours, geographic placement, and a calculated depth grid, together with source and review information. It does not preserve the original picture.</p>

  <h2>Extracting a line is different from understanding it</h2>
  <p>A vector PDF can contain actual drawn paths. Selecting their line styles avoids losing those paths when the page is turned into pixels. It still cannot tell us whether a path is a contour, a road, the shoreline, or a sample in the legend. A scanned PDF contains a picture instead, so it needs the same image tracing as a PNG or JPEG.</p>
  <p>Image tracing follows ink. Printed labels can break a contour; nearby text or a border can accidentally connect to one. A path that looks plausible at small scale may enclose the wrong part of the lake. Values are entered and confirmed by the maker, not automatically read from the chart.</p>
  <figure>
    <a href={`${base}/images/guides/chart-tracing-comparison.png`} aria-label="Open the historical Viking tracing comparison at full size"><img src={`${base}/images/guides/chart-tracing-comparison.png`} width="1440" height="820" loading="lazy" decoding="async" alt="Diagnostic comparison of raster and curated vector Lake Viking traces rendered with the application's representative stacked-layer previews." /></a>
    <figcaption>A historical diagnostic using the USGS Lake Viking chart. Both previews render a stack, but independent survey checks found substantially different basin fidelity. This predates mandatory review and is not an approved tracing example. A convincing preview is insufficient evidence of accuracy.</figcaption>
  </figure>
  <p>That is why preparation stops at editable proposals. You can remove stray marks, reconnect genuine gaps, redraw missed paths, and correct printed values before any depths are generated. The app rejects open or crossing contours and requires confirmation of every included path.</p>

  <h2>Why the first version supports a narrower set of charts</h2>
  <p>The current workflow supports flat charts of one lake, with a complete outer shoreline, explicit island boundaries, and closed depth contours. Each contour has its own printed value and a deeper or shallower interior. Validation checks immediate containment, so underwater rises and separate basins are supported. Crossing or touching networks, contours inside island land, incomplete charts, and perspective photographs remain unsupported.</p>
  <p>These restrictions reduce ambiguous interpretations. For example, a loop can describe either a deeper basin or a shallower underwater hill. Closing a broken line in the wrong direction can create a different basin. Supporting those cases well needs richer relationships between contours and better ways to review them.</p>
  <p>The compromise is more manual work and fewer supported charts in return for a result whose paths and values you can inspect. Passing the checks still cannot detect every missing contour or incorrect printed value.</p>

  <h2>Placing the chart needs geographic evidence</h2>
  <p>A shoreline shape alone can be ambiguous: a nearly oval lake may fit when turned end to end. The reviewed workflow instead asks for at least four distributed positions whose longitude and latitude are known. An affine fit translates, rotates, scales, and shears the source into map coordinates. It does not correct camera perspective or arbitrary distortion in an old scan.</p>
  <p>The dashed map outline makes the placement visible over the source. The app checks control-point spread, coordinate residuals, and shoreline overlap. Current guards allow at most 20 m of error at any entered control and require at least 80% intersection-over-union between the shorelines. These are rejection thresholds, not an accuracy promise or a tolerance for cutting.</p>
  <p>Several points derived from the same mistaken coordinate interpretation can agree perfectly with one another. Verify the coordinate system and lake orientation against the source. A small residual says the entered points fit together, not that they are correct.</p>
  <figure>
    <a href={`${base}/images/guides/chart-reviewed-workspace.png`} aria-label="Open the source review and generated basin at full size"><img src={`${base}/images/guides/chart-reviewed-workspace.png`} width="1600" height="1100" loading="lazy" decoding="async" alt="Reviewed King City South contours on the original chart, with a representative stack and depth map beside the source." /></a>
    <figcaption>The source remains visible alongside the calculated floor. In this King City example, corrections excluded land contours and a legend fragment and closed a genuine label gap. The prepared review draft was imported explicitly; the system did not discover those corrections on its own.</figcaption>
  </figure>

  <h2>The space between contours is calculated</h2>
  <p>A contour fixes depth along a line, not at every point of the lake. Elevation labels first become depths by subtracting the floor elevation from the chart's stated water-surface elevation. Units are converted consistently; for example, a floor at 1,020 ft under a 1,028.5 ft surface is 8.5 ft deep.</p>
  <p>The default interpolator holds the reviewed contours at their assigned depths and the source shoreline at zero, then solves for a smooth surface between them. This avoids the flat terraces that can arise from simply connecting equal-depth contour vertices with triangles. Smoothness is an assumption about the unsampled space, not additional survey evidence.</p>
  <p>The innermost contour does not measure the deepest point. Reviewed generation now holds its depth unless you explicitly supply an interior bottom or summit value. An explicit value shapes a smooth interior without claiming the exact position of the extreme. Earlier generation assumed half an interval beyond the last line; removing that hidden assumption can produce flatter bottoms. This is a deliberate compromise when the chart supplies no further evidence. Island interiors are excluded from the water grid and subtracted from the terrain water polygons, preventing fallback depths from carving them away.</p>
  <p>Images are limited to 2,400 pixels on the long side, paths are simplified, and the working depth grid has finite resolution. Stored depth samples use 0.1 m increments. Narrow channels and tiny features may be softened or lost; more decimal places in the controls cannot restore detail absent from the source.</p>

  <h2>A good floor still needs a fabrication review</h2>
  <p>The chart preview shows representative layers so you can compare basin appearance before applying the chart. The finished project's crop, vertical scale, depth exaggeration, material thickness, and feature-size settings determine the actual cut layers. A shallow shelf may occupy no separate sheet, and small changes in depth can move an edge onto a neighboring layer.</p>
  <figure>
    <a href={`${base}/images/guides/chart-generated-terrain.png`} aria-label="Open the resulting terrain stack at full size"><img src={`${base}/images/guides/chart-generated-terrain.png`} width="1600" height="1100" loading="lazy" decoding="async" alt="Six-layer King City South terrain stack with incomplete depth-chart coverage and low-relief warnings visible." /></a>
    <figcaption>The chart becomes part of the terrain before the final layers are generated. Here the source shoreline does not cover every map-water cell, so the coverage warning remains. Inspect the resulting edge transitions rather than assuming the two shorelines are identical.</figcaption>
  </figure>
  <p>Uncovered cells use existing terrain, modeled depths, or estimates near surveyed shores where possible; cells without enough information remain at the waterline. These fallback areas may have a different level of evidence from the reviewed chart interior.</p>
  <p>Saving requires a separate confirmation that you inspected the basin and layers. That review status travels with the chart in a project file. It records workflow completion, not a survey certificate or proof that the pieces will cut and assemble cleanly.</p>

  <h2>What our real-chart checks establish</h2>
  <p>In the earlier King City South benchmark (using the original half-interval interior assumption), eight underwater contours produced a 5 m grid without inferred contour labels. Comparison with 25,782 independent QA soundings gave a median absolute depth error of 0.120 m and a 95th-percentile error of 0.291 m, weighting each occupied 20 m cell equally.</p>
  <p>Those many soundings occupy only 21 cells, so they do not validate the whole lake or its shoreline. At a shared representative layer scale, all weighted comparisons were within one sheet; when each result was separately normalized to its own depth range, that fell to 81.4%. The reference normalization used the deepest QA sounding, not a verified whole-lake maximum.</p>
  <p>Those historical scores have not been extended to the new island/rise cases or the changed default interior. Automated topology and terrain-mask checks cover those cases separately. This supports one corrected example. It does not establish broad automatic tracing accuracy, final toolpath agreement, or physical cutability. A representative physical cut and assembly remains necessary to validate the fabrication appearance.</p>

  <h2>Where we want to improve</h2>
  <p>These are directions for future work, not features available today or a release schedule:</p>
  <ul>
    <li>Better proposals around printed labels and broken lines, with clearer indicators of uncertain connections.</li>
    <li>Easier coordinate calibration and correction, while keeping placement inspectable.</li>
    <li>Support for open contour networks, touching saddle relationships, and geographically positioned bottom or summit soundings. Closed islands and underwater rises are now supported.</li>
    <li>More independent real-chart benchmarks across scan quality, chart styles, and lake shapes.</li>
    <li>Fabrication-focused comparisons of final layer edges, thin bridges, and assembled pieces, beyond depth error alone.</li>
  </ul>
  <p>Improving automation should reduce repetitive work while keeping source review available. Until stronger validation supports a broader workflow, the reviewed paths, explicit coordinates, and final layer inspection remain essential.</p>

  <h2>Sources and related guides</h2>
  <p>Source charts: public-domain USGS <a href="https://pubs.usgs.gov/sim/3486/sim3486_sheet02.pdf">King City South, sheet 2</a> and <a href="https://pubs.usgs.gov/sim/3486/sim3486_sheet07.pdf">Lake Viking, sheet 7</a>. Independent King City checks use the associated <a href="https://www.sciencebase.gov/catalog/item/5f6b9ce482ce38aaa24556f7">USGS survey data release</a>. Screenshots are from TopoStack; map data © OpenStreetMap contributors. The images show software previews, not physically fabricated examples.</p>
  <p>Follow <a href={`${base}/guides/trace-a-depth-chart`}>the tracing workflow</a>, read <a href={`${base}/guides/how-lake-depths-work`}>how charted, surveyed, and modeled lake floors fit together</a>, or use <a href={`${base}/guides/troubleshooting`}>troubleshooting</a> when a review is blocked.</p>
</Article>
