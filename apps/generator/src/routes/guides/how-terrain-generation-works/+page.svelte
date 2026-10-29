<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  import { REPOSITORY_URL } from "$lib/site/site";
  const base = basePath();
</script>

<Article title="How terrain generation works" intro="TopoStack turns elevation samples into shapes you can cut and assemble. The geometry is calculated in your browser, where cached terrain, faster boundary searches, and parallel workers help keep large projects practical.">
  <p>A layered map needs more than a set of contour lines. Each sheet needs solid material, holes, room for glue, markings on exposed surfaces, and labels that fit. This guide follows those calculations and explains how we reduce the work behind them. For a first project, start with <a href={base + "/guides/laser-cut-topographic-map"}>the layered map guide</a>.</p>

  <h2>From map data to physical layers</h2>
  <figure class="pipeline">
    <ol aria-label="Terrain generation pipeline">
      <li><span>1. Sample the landscape</span><small>Elevation, water, and map features</small></li>
      <li><span>2. Build the terrain</span><small>Lake floors, scale, and sheet elevations</small></li>
      <li><span>3. Trace the material</span><small>Contour polygons, islands, and holes</small></li>
      <li><span>4. Prepare the pieces</span><small>Splits, material nests, and visible markings</small></li>
      <li><span>5. Finish the stack</span><small>Alignment guides, labels, and annotations</small></li>
      <li><span>6. Preview and export</span><small>Shared geometry for views and SVG files</small></li>
    </ol>
    <figcaption>Source data is fetched over the network. The browser calculates the terrain geometry and prepares the fabrication output.</figcaption>
  </figure>
  <p>The selected geographic area determines which elevation and vector tiles are needed. The browser combines the elevation samples into a grid and brings roads, waterways, and other features into the map's coordinates. Where water depth is enabled, available depth data or modeled lake floors shape the terrain before its layers are traced. See <a href={base + "/guides/how-lake-depths-work"}>how lake depths work</a> for those data choices.</p>
  <p>For a layered relief, geographic scale, artwork width, terrain relief, vertical exaggeration, and material thickness determine the elevation represented by each sheet. TopoStack rounds the stack to whole sheets and fits the resulting vertical scale. Layer count follows from those choices.</p>
  <p>At each elevation, the contour calculation finds the boundary of material above that height. Crossings between grid samples are interpolated, then the polygons are converted to millimeters, clipped to the selected outline, and processed using the project's smoothing and minimum-feature settings. Disconnected peaks become separate shapes; enclosed low areas become holes.</p>
  <p>The next steps split oversized layers when required, plan material-saving nests, and place markings on the material that remains visible. Finally, the generated geometry feeds the cut preview, the 3D view, and SVG packaging. These views share the same layer outlines, while rendering and export apply their own presentation and fabrication steps.</p>

  <h2>Why large maps take more work</h2>
  <p>Increasing the physical width while keeping the same geographic area and vertical exaggeration also increases the model's height. With the same sheet thickness, that usually means more layers. Thinner sheets and greater exaggeration increase the count too.</p>
  <p>Each layer can contain thousands of boundary segments. A road crossing many layers needs repeated clipping; a label may try many positions before finding one that fits. Material-saving nests need containment and clearance checks. A tall stack with intricate contours and many roads can therefore cost much more than its elevation-grid size alone suggests.</p>
  <p>Those repeated geometry checks were a major target of the performance work. The optimizations below keep the configured terrain detail and fabrication tolerances while reducing repeated calculations.</p>

  <h2>Reuse terrain when only the finishing changes</h2>
  <p>The generation worker keeps the most recent prepared terrain: water calculations, the elevation ladder, and the raw contour layers. Changing an annotation or fabrication setting can reuse that work. For example, turning elevation labels off still requires the finishing stages to run, but it does not require tracing the landscape again.</p>
  <p>Changes that affect terrain, such as artwork size, sheet thickness, exaggeration, smoothing, depth settings, or the source data, invalidate the cached terrain. The cache holds one terrain result per generation session. It is not a saved library of every map you have visited.</p>
  <p>Before nesting or splitting changes a layer, generation makes a working copy of its cached contours. This prevents a cavity cut for one version of the project from appearing in a later version by accident. An unchanged source bundle also stays in the worker, avoiding another large transfer from the page for each settings edit.</p>

  <h2>Search nearby boundaries and reuse the results</h2>
  <p>A label near one edge rarely needs to inspect every edge on the opposite side of a complex polygon. TopoStack groups boundary segments into a hierarchy of bounding boxes. Clipping, containment, and clearance searches skip groups that cannot intersect the area being checked, then apply the existing geometry checks to the remaining segments.</p>
  <p>Nesting and label placement reuse these prepared boundaries across candidate positions. When nesting adds or removes a cavity, its affected indexes are rebuilt. Containment checks also use the fact that a connected outline cannot leave a containing shape without crossing its boundary, while still checking holes and the required clearances.</p>
  <p>For tall stacks with many features, TopoStack combines the covering material above each layer before clipping roads. That replaces repeated searches through buried contours with a search of their combined boundary. Sparse maps keep the cheaper direct approach, and a failed boundary combination falls back to the original covering shapes.</p>

  <h2>Share independent layer work across processor cores</h2>
  <p>The main geometry worker moves calculation off the page's interface thread. For relief stacks of at least 32 layers, it can also start up to four helper workers, using the browser's reported processor count to limit concurrency. Each helper receives two layers at a time, then takes another batch when it finishes.</p>
  <p>Helpers calculate alignment guides and search for elevation-label positions. The coordinator collects their results in layer order and makes the final label choices across the stack. A faster worker finishing first therefore does not change which layer receives its markings or how neighboring labels are coordinated.</p>
  <p>Workers are reused across edits, and each loads the selected label font when needed. Small maps and flat engravings use the serial path. Contour extraction, material nesting, and feature routing still run in the coordinator; adding workers cannot accelerate every stage.</p>
  <p>When settings change during a helper batch, obsolete work can be cancelled so the next request can proceed. If helpers cannot start, fail, or time out, generation retries that stage on the coordinator. Completed fragments from a failed batch are not mixed into the retried result.</p>

  <h2>What we measured on Grand Teton</h2>
  <p>On September 24, 2026, we tested a 3,000 × 3,000 mm Grand Teton relief with 3 mm sheets, 2× vertical exaggeration, and a 768 × 768 elevation grid. It produced 193 layers with material nesting, alignment guides, and elevation labels enabled.</p>
  <table>
    <caption>Local geometry-generation time: optimized serial execution versus four helpers</caption>
    <thead><tr><th scope="col">Workload</th><th scope="col">Serial</th><th scope="col">Four helpers</th></tr></thead>
    <tbody>
      <tr><th scope="row">Terrain, two runs</th><td>15.39–21.63 s</td><td>10.09–10.11 s</td></tr>
      <tr><th scope="row">Turn elevation labels off, same terrain, two runs</th><td>8.50–8.65 s</td><td>5.17–5.44 s</td></tr>
      <tr><th scope="row">Terrain with 300 synthetic road paths, one run</th><td>22.82 s</td><td>18.40 s</td></tr>
    </tbody>
  </table>
  <p>These measurements ran the production task scheduler through Node worker threads on a local development machine. They include helper startup and transfers between helpers and the coordinator. They exclude map downloads, browser coordinator startup, source transfer from the page, 3D rendering, and export. Other development processes were active, and the samples are too few to promise a fixed speedup on another device.</p>
  <p>The elevation data was real; the optional roads were artificial full-width stress paths, not the actual Grand Teton road network. The fixture contained no lake-depth data. The label toggle changes the workload as well as reusing the cache, so its time does not measure caching alone. Both columns already include the earlier serial optimizations.</p>

  <h2>Check speed against the same output</h2>
  <p>For the benchmark, we compared complete generated results with only their timestamps removed. Output hashes matched between serial and parallel execution. Separate production-worker checks in Chromium, Firefox, and WebKit covered custom fonts, cancellation, reuse, and unavailable helpers. Within each browser, parallel generation and serial fallback produced identical results.</p>
  <p>These checks support the tested geometry and worker behavior. A project still needs its usual review of cut layers, small pieces, material fit, and assembly. Faster generation does not add detail that was absent from the elevation or depth data.</p>

  <h2>Working with a demanding project</h2>
  <p>Choose the geographic area, physical size, material thickness, and vertical scale before spending time on labels and decoration. Once the terrain is settled, many finishing edits can reuse it. A reload or a replaced generation worker needs to calculate that terrain again.</p>
  <p>If generation remains slow, inspect the layer count and the amount of linework. Fewer road details reduce clipping work. Thicker material or lower exaggeration can reduce the number of sheets, but also change the finished design. Turning off material-saving nests removes their calculation and changes how much material the project needs. Use those choices deliberately, with the cut preview as your check.</p>
  <p>This terrain optimization uses JavaScript geometry and Web Workers. A Rust or WebAssembly terrain kernel remains a possible future step; the current gains come from reusing work, narrowing searches, and running independent calculations concurrently.</p>
  <p>Continue with <a href={base + "/guides/split-large-maps"}>splitting large maps</a>, the <a href={base + "/guides/settings-reference"}>settings reference</a>, or <a href={base + "/guides/export-files"}>export files</a>. For implementation details and reproducible benchmark commands, see the repository's <a href={REPOSITORY_URL + "/blob/main/docs/generation-performance.md"}>generation performance notes</a> and <a href={REPOSITORY_URL + "/blob/main/docs/reports/generation-parallel-benchmark-20260924.md"}>parallel benchmark report</a>.</p>
</Article>

<style>
  .pipeline ol { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; padding: 0; list-style: none; }
  .pipeline li { margin: 0; padding: 16px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); background: var(--loidolt-surface); }
  .pipeline span { display: block; font-weight: 600; }
  .pipeline small { display: block; color: var(--loidolt-text-muted); font-size: 13px; line-height: 1.6; margin-top: 4px; }
  caption { text-align: left; font-size: 14px; line-height: 1.6; color: var(--loidolt-text-muted); margin-bottom: 12px; }
  @media (max-width: 540px) { .pipeline ol { grid-template-columns: 1fr; } }
</style>
