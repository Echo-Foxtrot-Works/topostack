<script lang="ts">
  import WaterFinishComparison from "$lib/site/WaterFinishComparison.svelte";
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="How to make a custom lake depth map" intro="A layered lake map steps down layer by layer from the shoreline to the deepest hole, so the bays, drop-offs and islands people know from the water show up in wood. Here is how to make one of a real lake with TopoStack.">
  <h2>What makes a good lake map</h2>
  <p>The difference between a lake map and a flat cutout is the lake floor. TopoStack includes surveyed depth data for thousands of lakes, so the layers follow measured depths rather than an even slope. Where a lake has no survey, the studio models depths from the shoreline and the surrounding terrain and tells you so. Surveyed lakes give the most recognizable result. If yours has no survey but you have a printed depth chart of it, you can <a href={`${base}/guides/trace-a-depth-chart`}>trace the chart</a> and carve the lake from that instead.</p>

  <h2>1. Find your lake</h2>
  <p>Browse <a href={`${base}/lakes`}>lake depth maps by region</a>. Minnesota is listed by county, and Ontario, Finland and Norway by name. You can also <a href={`${base}/guides/lake-depth-data`}>search the lake directory</a> by name, county or survey ID. Select a lake to open the studio framed to its survey area.</p>
  <p>If your lake is not listed, search for it in the studio instead. TopoStack still cuts the shoreline and models a plausible floor; <a href={`${base}/guides/how-lake-depths-work`}>how lake depths work</a> explains what to expect.</p>

  <h2>2. Frame the whole lake</h2>
  <p>Include the whole lake and a margin of surrounding land. The land around the shore gives the map its edge and helps TopoStack estimate any unsurveyed parts. In <strong>Cut size</strong>, choose a rectangle or a circle and enter the finished width. A long, narrow lake usually fits a rectangle; a round lake often looks best in a circle.</p>

  <h2>3. Choose the material and depth</h2>
  <p>Open <strong>Terrain layers</strong> and enter your measured sheet thickness. The studio works out how many sheets the land and the lake floor need. Thin sheets such as 3 mm plywood or basswood give more steps and a smoother lake floor; thicker sheets mean fewer, bolder steps.</p>
  <p>Lakes are shallow compared with their width, so depth is exaggerated to make it visible. If the lake needs more depth sheets than you want to cut, turn on <strong>Limit depth layers</strong>, set <strong>Maximum depth layers</strong>, and turn on <strong>Fit lake depth to available layers</strong>. TopoStack then compresses the depths into that many sheets while the shoreline stays where it is. The <a href={`${base}/guides/settings-reference`}>settings reference</a> lists each control.</p>

  <h2>4. Add the details that make it personal</h2>
  <p>In <strong>Map details</strong>, choose roads, trails and labels for context, and keep <strong>Water depth</strong> on. To mark a cabin, a dock or a favorite fishing spot, add a marker in the <strong>Custom data</strong> view by clicking the map or entering its coordinates, or import a GPX track of a paddling route. See <a href={`${base}/guides/custom-markers-and-paths`}>custom markers and paths</a>.</p>

  <h2>5. Choose your water finish</h2>
  <WaterFinishComparison links />

  <h2>6. Generate, export and cut</h2>
  <p>Select <strong>Generate terrain</strong>, check the warnings about survey coverage or estimated depths, and step through the <strong>Cut layers</strong> view. Then open <strong>Export</strong> for the SVG cut panels, the assembly guide and <strong>ATTRIBUTION.txt</strong>, which credits the lake survey. If the map is bigger than your laser bed, <a href={`${base}/guides/split-large-maps`}>split it into pieces</a>. The <a href={`${base}/guides/laser-cut-topographic-map`}>layered map guide</a> covers kerf, nesting and assembly in detail.</p>

  <h2>Check before you cut</h2>
  <p class="note">Confirm the imported size and your kerf setting, and cut one small layer as a test before committing the whole stack. Survey dates and water levels vary, so a lake floor from an older survey may differ from today’s lake.</p>
</Article>
