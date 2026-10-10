<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
</script>

<Article title="Make an airspace model in 3D" intro="Show the sky above a place as acrylic over a wooden terrain relief. Choose airspace classes, compare three ways to build them, and inspect the pieces before you cut.">
  <h2>Start with an airport and its surroundings</h2>
  <p>Choose <strong>Layered</strong> in the <a href={`${base}/studio`}>studio</a>, find a US airport, and frame the surrounding area in <strong>Map</strong>. Denver is a useful first Class B project; Colorado Springs (COS) is a useful Class C project. A wider crop shows the changing shelf footprints; a tight crop around a runway may sit entirely inside one sector and produce a single plate.</p>
  <p>Open <strong>Fabrication settings</strong> and turn on <strong>Airspace in 3D</strong>. This builds acrylic above the terrain. The aviation details in <strong>Map details</strong> draw airport and airspace linework instead; those switches do not turn on the acrylic model.</p>
  <p class="note">FAA coverage includes the US and its territories. Only the selected Class B, C, D and special use sectors are modeled. The default Crater Lake crop may have no selected airspace. These are decorative models, not for navigation or flight planning.</p>

  <h2>Choose how to build the airspace</h2>
  <table>
    <thead><tr><th scope="col">Build as</th><th scope="col">What you make</th><th scope="col">When to choose it</th></tr></thead>
    <tbody>
      <tr><td>Plates</td><td>Clear acrylic at the altitudes where airspace starts or ends. Engraved shelf markings show the sectors; the space between plates stays open.</td><td>A clear view through the model with fewer acrylic sheets.</td></tr>
      <tr><td>Tiers</td><td>Tinted pieces at shelf boundaries, with open space between levels. Class B is blue and Class C is magenta.</td><td>Show each shelf's footprint and distinguish the classes.</td></tr>
      <tr><td>Solid volumes</td><td>Acrylic sheets fill each modeled sector from floor to ceiling.</td><td>A solid representation when you can accommodate the extra material and weight.</td></tr>
    </tbody>
  </table>
  <p>The pieces are clipped to your map frame. Special use sectors are blue or magenta according to their kind; Class D is represented as a lid rather than a filled tower-airport volume.</p>

  <h2>Choose the classes and ceiling</h2>
  <p><strong>Class B</strong>, <strong>Class C</strong> and <strong>Special use</strong> are on initially. Turn on <strong>Class D</strong> for tower-airport lids. At least one kind stays selected. Special use includes areas such as MOAs, restricted and warning areas; small fragments or areas outside your frame may produce no pieces.</p>
  <p><strong>Ceiling cap</strong> limits how high the model extends, in feet above mean sea level (MSL). The automatic cap uses the highest selected Class B or C ceiling in the crop, or 10,000 ft when there is none. An explicit cap can cut off a sector or exclude it entirely if its floor is above the cap. Use <strong>Cap at the highest Class B or C ceiling</strong> to return to automatic selection.</p>
  <p>Charted MSL heights stay tied to sea level. Surface and AGL limits follow the terrain, with steps where the wooden sheets require them; flight levels are converted for the model. Unlimited sectors stop at the ceiling cap. Engraved annotations retain the original altitude reference where they fit.</p>

  <h2>Set the scale and acrylic</h2>
  <p>Airspace uses the terrain's <strong>Vertical exaggeration</strong>. Around a whole Class B airport, 10× is a useful starting point for separating shelves. A tight airport crop may already make the airspace very tall: widening the crop or lowering exaggeration reduces its physical height. Watch the reported height in the airspace settings.</p>
  <p>Set <strong>Acrylic thickness</strong> to your measured stock and <strong>Acrylic kerf</strong> to your laser's cut width in acrylic. Their initial values follow the terrain material thickness and laser kerf. Rod size, fit clearance and socket depth control the supports; see <a href={`${base}/guides/airspace-assembly`}>cutting and assembling airspace</a> before choosing them.</p>

  <h2>Generate and inspect both previews</h2>
  <ol>
    <li>Select <strong>Generate terrain</strong> or <strong>Regenerate terrain</strong> after choosing the crop. Wait for generation to finish. Enabling airspace on generated terrain also updates its data and geometry.</li>
    <li>Choose <strong>3D stack</strong>. Orbit the model to see each shelf and its supports. The airspace settings report pieces, levels, total height and rods.</li>
    <li>Choose <strong>Cut layers</strong>, then set <strong>Cut material</strong> to <strong>Airspace acrylic</strong>. Move the level slider to inspect cut outlines, sockets and engraved markings at each altitude. Choose <strong>Terrain sheets</strong> to inspect the wood and its rod sockets.</li>
    <li>Read the warnings. Closely spaced boundaries may merge onto one level; small or unsupported pieces may be omitted. A merged or simplified model should be compared with your intended design before cutting.</li>
  </ol>
  <figure>
    <img src={`${base}/images/guides/airspace-denver.webp`} width="1600" height="1100" loading="lazy" decoding="async" alt="Real Denver terrain in the studio's 3D view, with blue Class B acrylic tiers and support rods above the wooden map." />
    <figcaption>Denver Class B as tiers in the development studio. FAA 2026-10-01 cycle; vertical exaggeration 10×. A software preview, not a completed physical build.</figcaption>
  </figure>

  <h2>If the sky stays empty</h2>
  <p>Check the piece count in the airspace settings. With zero pieces, confirm that the crop includes a selected class, that the ceiling cap is above its floor, and that pieces are not being removed by terrain clearance or support constraints. Try a wider airport crop. Class E and G are not built by this feature.</p>
  <p>If data is unavailable, regenerate after the connection recovers. After a data update, a hard refresh or a private window can help identify a cached archive. If pieces are listed but not visible, return to <strong>3D stack</strong> and zoom out to include their height. For a reproducible report, use <strong>Copy share link</strong> or export your project settings. See <a href={`${base}/guides/troubleshooting#airspace-is-missing-or-incomplete`}>airspace troubleshooting</a>.</p>

  <h2>Export the model</h2>
  <p>Open <strong>Export</strong> and choose <strong>Airspace</strong> for its acrylic files, or <strong>Complete project</strong> for terrain and airspace together. The export includes the rod cut list and assembly instructions. Missing or incomplete requested data and stacks that exceed fabrication limits must be resolved before exporting. Continue with <a href={`${base}/guides/airspace-assembly`}>the airspace assembly guide</a>.</p>
</Article>
