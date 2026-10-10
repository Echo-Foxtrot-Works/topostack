<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Cut and assemble acrylic airspace" intro="Turn the preview into separate wood, acrylic and rod jobs. Use the exported piece maps, rod lengths and level heights to build the airspace above your terrain.">
  <h2>Check the design before buying material</h2>
  <p>First follow <a href={`${base}/guides/airspace-in-3d`}>the airspace design guide</a>. Read the piece, level, height and rod counts in <strong>Fabrication settings</strong>, and inspect every airspace level in <strong>Cut layers</strong>. Plates and tiers leave open space between shelves; solid volumes use many more sheets and can be much heavier.</p>
  <p>Review warnings about merged levels, omitted pieces, tall stacks, support reach and acrylic stock. The software checks geometry; it does not establish glue strength or a safe mechanical load. Test a representative piece and joint before cutting the full project.</p>

  <h2>Set acrylic and rod dimensions</h2>
  <p>Measure your acrylic and enter <strong>Acrylic thickness</strong>. Calibrate <strong>Acrylic kerf</strong> separately from the wood's laser kerf. Choose <strong>Rod shape</strong>, then enter <strong>Rod diameter</strong> or <strong>Rod width</strong> for the stock you intend to use. <strong>Socket clearance</strong> adds room for the fit, and <strong>Socket depth</strong> sets how far a rod seats into the terrain.</p>
  <p>Cut a socket and hole coupon in your actual material, check the fit with your rods, and adjust the settings before regenerating. Keep kerf compensation in one place: if TopoStack compensates the files, disable a second compensation in your laser software. Use processing settings suitable for the exact material and your machine.</p>

  <h2>Choose how the rods meet the pieces</h2>
  <table>
    <thead><tr><th scope="col">Rods meet pieces</th><th scope="col">How to assemble</th><th scope="col">What to check</th></tr></thead>
    <tbody>
      <tr><td>Glued segments</td><td>Short rods join adjacent levels or rise from the terrain. Their engraved outlines locate the seats on the acrylic.</td><td>Match each rod's exported length and keep the piece level while the adhesive cures.</td></tr>
      <tr><td>Through holes</td><td>Rods rise through holes in the pieces they carry. The guide identifies the column, rod and each supported piece's height.</td><td>Slide pieces on before fixing the top. Follow any additional segmented supports shown in the guide.</td></tr>
    </tbody>
  </table>
  <p>A through-rod design may still need short segments where a single rod cannot reach safely. Follow the generated map for your project rather than assuming that every support runs through the whole stack.</p>

  <h2>Download and separate the jobs</h2>
  <p>Choose <strong>Complete project</strong> in <strong>Export</strong> to keep the wood, airspace, instructions and settings together. <strong>Airspace</strong> downloads the airspace bundle alone. File names identify the material, color and level; levels count from the bottom upward.</p>
  <table>
    <thead><tr><th scope="col">File</th><th scope="col">Use it for</th></tr></thead>
    <tbody>
      <tr><td><code>my-map-airspace-blue-02.svg</code></td><td>The blue acrylic pieces on level 02. Other jobs use <code>clear</code> or <code>magenta</code>.</td></tr>
      <tr><td><code>…-airspace-blue-master.svg</code></td><td>The combined layout for that acrylic color. Check the layout against your stock and laser bed.</td></tr>
      <tr><td><code>…-engrave.svg</code></td><td>The matching engraving companion. Use either the panel's engraving or this companion, once.</td></tr>
      <tr><td><code>my-map-airspace-backing.svg</code></td><td>A backing sheet when rods seat through the bottom terrain layer. Cut it from the terrain's material.</td></tr>
      <tr><td><code>my-map-assembly-guide.html</code></td><td>Open in a browser for the rod cut list, piece maps and the assembly order. It also prints.</td></tr>
      <tr><td><code>README.txt</code> and <code>my-map-project.json</code></td><td>The fabrication settings, scale, source cycle and a record of the generated design.</td></tr>
    </tbody>
  </table>
  <p>Follow the <a href={`${base}/guides/lightburn`}>LightBurn workflow</a> or the equivalent checks in your laser software. SVG processing colors identify cut, score and engraving operations; they do not identify which color of acrylic to buy.</p>

  <h2>Build from the terrain upward</h2>
  <ol>
    <li>Cut and label the terrain and acrylic pieces, keeping each level's parts together. Process engraving once and check the sockets before removing the pieces from the job.</li>
    <li>Assemble the wooden terrain using its exported layer instructions. Add the backing sheet when the guide calls for one.</li>
    <li>Cut the rods to the lengths in the guide, allowing extra stock for saw cuts. Keep their rod IDs with them.</li>
    <li>Dry-fit the lowest acrylic level and its supports using the piece and rod maps. Match piece IDs such as <code>A1-1</code> and the column/rod references in the guide.</li>
    <li>For through rods, use the guide's heights measured from the terrain face at each rod. For glued segments, locate each end using the engraved seat outline. Keep every shelf level.</li>
    <li>Work upward in the guide's order. Some solid-volume sheets rest directly on the acrylic below; retain every extra support that the guide specifies.</li>
    <li>Confirm the complete dry fit, then bond with an adhesive appropriate for your acrylic and rods. Keep the assembly supported for the adhesive's specified curing time.</li>
  </ol>
  <p>Use the engraved sector names, altitude references and piece maps to identify shelves. Some narrow regions cannot fit a full label; the guide and saved project retain the design's references.</p>

  <h2>Keep the source and scale with the finished piece</h2>
  <p>Keep the exported FAA cycle, ceiling cap and vertical exaggeration with the model. A ceiling cap truncates the representation; merged levels and terrain steps simplify it. The model does not show current airspace activity, NOTAMs or temporary flight restrictions. It is decorative and not for navigation.</p>
  <p>For settings and file details, see <a href={`${base}/guides/settings-reference#airspace-in-3d`}>the airspace settings reference</a> and <a href={`${base}/guides/export-files#airspace-files`}>airspace export files</a>.</p>
</Article>
