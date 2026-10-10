<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Troubleshooting and common questions" intro="What the studio's export messages and warnings mean, and how to fix the problems makers run into most often.">
  <h2>Depth-chart review is blocked</h2>
  <dl>
    <div><dt>Generate reviewed depths is unavailable</dt><dd>Confirm every included path and its value, choose and confirm the source shoreline, and resolve open paths, crossings, or contradictory local depth relationships. Mark islands as land boundaries and underwater rises as shallower interiors. Interior bottom or summit values belong only on innermost contours. Follow <a href={`${base}/guides/trace-a-depth-chart`}>the reviewed tracing workflow</a>.</dd></div>
    <div><dt>Alignment does not pass</dt><dd>Use at least four known positions spread across the source, each with both longitude and latitude in WGS84 decimal degrees. Check hemisphere signs, coordinate conversion, and lake selection. Inspect the dashed map outline against the source shoreline before confirming.</dd></div>
    <div><dt>Keep this chart is unavailable</dt><dd>Generate from the current reviewed contours, then confirm that you checked the basin and layers. Edits make earlier results and approval stale.</dd></div>
    <div><dt>An older chart needs review</dt><dd>Legacy charts can be exported for recovery but cannot be applied to new generations. Recreate the chart from its original source through contour, alignment, and layer review.</dd></div>
    <div><dt>A review draft will not restore</dt><dd>Upload the same original file and PDF page first. The draft is tied to that source and does not contain the image. A restored draft requires fresh alignment confirmation and depth generation.</dd></div>
    <div><dt>Incomplete depth chart coverage</dt><dd>The source shoreline or grid does not cover every map-water cell. Uncovered areas use existing terrain, modeled depths, or estimates near surveyed shores when possible; remaining cells stay at the waterline. Inspect transitions in the final cut layers.</dd></div>
  </dl>

  <h2>Export is blocked</h2>
  <p>The <strong>Export</strong> dialog explains why artwork downloads are unavailable. <strong>Project settings</strong> can always be downloaded, so save them first if you are unsure.</p>
  <dl class="issues">
    <div><dt>“Generate real terrain data before exporting…”</dt><dd>The studio is showing the bundled preview or sample terrain rather than freshly generated data. Select <strong>Generate terrain</strong>; restored and imported projects need this too. If generation falls back to sample terrain, the map service could not be reached; try again later.</dd></div>
    <div><dt>“Project settings changed. Regenerate the terrain before exporting.”</dt><dd>The map area or cut aspect ratio changed after generation. The status line under the preview names what changed. Select <strong>Regenerate terrain</strong>. Terrain exaggeration, map features, labels and line widths update on their own.</dd></div>
    <div><dt>“Map detail data exceeded the safe feature limit…”</dt><dd>The area contains more roads, trails, water and boundaries than TopoStack can safely process. Frame a smaller area or turn off some details in the <strong>Features</strong> or <strong>Water</strong> panel, then regenerate.</dd></div>
    <div><dt>“Map detail data is unavailable…” or “Lake depth data is unavailable…”</dt><dd>A data service did not respond. Regenerate later, or turn off the affected details (or <strong>Water depth</strong>) to export without them.</dd></div>
    <div><dt>“One or more layers are empty…”</dt><dd>A layer has no piece large enough to cut. Lower the <strong>Vertical exaggeration</strong>, use thicker material, reduce <strong>Minimum feature</strong> in the <strong>Fabricate</strong> panel, or frame an area with more relief, then regenerate.</dd></div>
    <div><dt>“…exceeds Atomm’s 100 MB export limit.”</dt><dd>The artwork is too detailed. Turn off dense details such as roads or water fills, or frame a smaller area.</dd></div>
  </dl>

  <h2>Warnings after generating</h2>
  <p>Warnings appear above the preview. They do not block export, but read them before you cut.</p>
  <dl class="issues">
    <div><dt>Pieces remain larger than the work area, or the work area was not applied</dt><dd>The model is too large for your work area to split cleanly: either some pieces still overflow the bed, or the split was skipped entirely. Use a larger work area, a smaller model, or thicker material for fewer layers.</dd></div>
    <div><dt>Very little elevation change</dt><dd>Flat areas produce layers that look nearly identical, or sparse contours. Raise the vertical exaggeration or contour density, or include more of the surrounding hills.</dd></div>
    <div><dt>Water is deeper than the sheets below the shoreline can hold</dt><dd>An explicit depth-layer limit can flatten the lake floor. Turn off <strong>Limit depth layers</strong> for automatic coverage, increase the allowance, or select <strong>Fit depth</strong> to compress the lake instead, lower <strong>Depth exaggeration</strong>, or use thinner material. <a href={`${base}/guides/how-lake-depths-work#layers`}>How depth settings affect layers</a>.</dd></div>
    <div><dt>Some lake depths are estimated rather than surveyed</dt><dd>At least one lake is modeled in whole or part. This is expected for most lakes. <a href={`${base}/guides/how-lake-depths-work#confidence`}>How to read the result</a>. If you have a depth chart of the lake, <a href={`${base}/guides/trace-a-depth-chart`}>trace it</a> to replace the estimate.</dd></div>
    <div><dt>Some lake floors come from a traced depth chart</dt><dd>A lake is carved from a chart you traced. Step through <strong>Cut layers</strong> and compare the deepest sheets with the chart before cutting.</dd></div>
    <div><dt>A lake extends past the edge of this map</dt><dd>No shoreline is visible, so its depth cannot be modeled. Zoom out to include part of the shore.</dd></div>
    <div><dt>A label or elevation labels were omitted</dt><dd>The text does not fit on the material. Increase the output size or reduce <strong>Text size</strong>.</dd></div>
    <div><dt>Upper sheets or contours were omitted from a circular crop</dt><dd>The circle left no piece at those elevations larger than <strong>Minimum feature</strong>. Reduce that setting, or center the crop on the high ground.</dd></div>
    <div><dt>Higher-resolution terrain is unavailable</dt><dd>The area has registered lidar terrain that could not be loaded, so standard elevation data is used. Regenerate later if you want the higher resolution.</dd></div>
    <div><dt>Isolated depth spikes were replaced</dt><dd>Obvious errors in the elevation data were filled from nearby terrain. Inspect that area in the preview before cutting.</dd></div>
    <div><dt>Some roads, trails, water lines or boundaries may be missing</dt><dd>The map detail limit was reached. Frame a smaller area for complete details.</dd></div>
  </dl>

  <h2>Common questions</h2>
  <h3>Why can’t I choose the number of layers?</h3>
  <p>Layer count follows from the elevation range, map scale, <strong>Vertical exaggeration</strong> and material thickness, with no upper sheet cap. For more layers, raise the exaggeration or use thinner material; for fewer, do the opposite. Automatic lake depth adds sheets below the land without reducing its relief.</p>
  <h3>Why does my exaggeration change after generating?</h3>
  <p>TopoStack rounds relief to whole material sheets, with a minimum of two. That rounding can change the applied exaggeration. The studio shows the applied value, and README.txt records it.</p>
  <h3>Why does my lake look flat?</h3>
  <p>The lake may be too shallow for your sheet interval, have no survey or published depth, or have <strong>Water depth</strong> turned off. See <a href={`${base}/guides/how-lake-depths-work#layers`}>why finished layers can look different</a>.</p>
  <h3>My SVG imports at the wrong size.</h3>
  <p>TopoStack SVGs declare their size in millimeters. Check that your laser software is not rescaling SVGs on import, for example by assuming a fixed DPI, and compare the imported width with the size you set.</p>
  <h3>My pieces fit too tightly or too loosely.</h3>
  <p>Measure your laser’s kerf on your material and enter it as <strong>Laser kerf</strong>. If your laser software also compensates for kerf, set TopoStack’s value to 0. See <a href={`${base}/guides/export-files#kerf-panel-size-and-alignment-marks`}>kerf and panel size</a>.</p>
  <h3>Some small pieces fell out of a sheet. Where do they go?</h3>
  <p>With <strong>Material-saving nests</strong> on, smaller layers are cut from inside larger ones. Each panel’s file name lists the layers it holds (for example <code>panel-02-layers-02-05</code>), and README.txt explains nesting. Keep every loose piece.</p>
  <h3>Where did my project go?</h3>
  <p>Projects are saved in the browser you used. A different browser, a private window or cleared site data starts fresh. Export <strong>Project settings</strong> to keep a backup, and import it in the studio to continue; then regenerate terrain before exporting.</p>
  <h3>Is the terrain accurate enough for navigation or engineering?</h3>
  <p>No. Elevation and lake data are resampled, simplified and scaled for decorative fabrication.</p>

  <h2>Still stuck?</h2>
  <p>Use <strong>Feedback</strong> in the studio or at the bottom of this page to report a bug or a data problem. Including the optional diagnostics, or your project settings file, helps reproduce it. See <a href={`${base}/guides/export-files`}>export files</a> for what each download contains.</p>
</Article>

<style>
  .issues > div { padding-block: 16px; border-bottom: 1px solid var(--loidolt-border); }
  dt { font-weight: 600; line-height: 1.5; }
  dd { margin: 8px 0 0; line-height: 1.8; }
</style>
