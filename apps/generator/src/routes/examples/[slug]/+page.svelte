<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
  import ExampleActions from "$lib/site/ExampleActions.svelte";
  import { EXAMPLES_HOME, exampleStudioPath } from "$lib/site/site";

  let { data } = $props();
  const example = $derived(data.example);
  const capture = $derived(example.capture);
  const inches = (mm: number): string => (mm / 25.4).toFixed(mm / 25.4 >= 10 ? 1 : 2).replace(/\.?0+$/, "");
  const size = $derived(example.shape === "circle" ? `${example.widthMm} mm (${inches(example.widthMm)} in) circle` : `${example.widthMm} × ${example.heightMm} mm (${inches(example.widthMm)} × ${inches(example.heightMm)} in)`);
  const trail = $derived([{ path: EXAMPLES_HOME, label: "Examples" }, { path: `${EXAMPLES_HOME}/${example.slug}`, label: example.place }]);
</script>

<Article title={`${example.place} topographic map`} intro={example.summary} {trail}>
  <figure>
    <picture>
      <source type="image/webp" srcset={`${base}/images/examples/${example.slug}-800.webp ${Math.min(800, capture.image.width)}w, ${base}/images/examples/${example.slug}.webp ${capture.image.width}w`} sizes="(max-width: 720px) 100vw, 760px" />
      <img src={`${base}/images/examples/${example.slug}.webp`} width={capture.image.width} height={capture.image.height} alt={`${example.place} as a ${capture.layers}-layer laser-cut relief, rendered in the TopoStack studio.`} />
    </picture>
    <figcaption>{example.place}, {example.region}, generated in the TopoStack studio. Terrain: Mapzen. Map data © OpenStreetMap contributors.</figcaption>
  </figure>
  <ExampleActions slug={example.slug} download />

  <h2>The project</h2>
  <table>
    <tbody>
      <tr><th scope="row">Cut size</th><td>{size}</td></tr>
      <tr><th scope="row">Material</th><td>3.175 mm (1/8 in) sheets</td></tr>
      <tr><th scope="row">Vertical exaggeration</th><td>{example.verticalExaggeration}×</td></tr>
      <tr><th scope="row">Elevation range in the frame</th><td>{capture.reliefM.toLocaleString("en-US")} m</td></tr>
      <tr><th scope="row">Layers</th><td>{capture.layers}, {capture.heightMm} mm ({inches(capture.heightMm)} in) tall</td></tr>
    </tbody>
  </table>

  <h2>Why these settings</h2>
  <ul>{#each example.notes as note (note)}<li>{note}</li>{/each}</ul>

  <h2>Make it yourself</h2>
  <ol>
    <li><a href={`${base}${exampleStudioPath(example.slug)}`}>Open this project in the studio</a>. It opens with the map area and every setting above and generates the terrain. Fresh data can change the layer count slightly from the one listed here, and <strong>Undo</strong> returns to the project you had open before.</li>
    <li>Check the cut layers and 3D preview, then open <strong>Export</strong> for the SVG cut panels and assembly guide.</li>
  </ol>
  <p>The downloadable project file holds the same settings. Keep it as a record, or open it later with <strong>Import project JSON</strong> next to the project name in the studio.</p>
  <p>To change it, set your own sheet thickness in the <strong>Terrain</strong> panel or a new size in the <strong>Place</strong> panel; the studio recalculates the layers. The <a href={`${base}/guides/laser-cut-topographic-map`}>layered map guide</a> covers kerf, nesting and assembly, and the <a href={`${base}/guides/topographic-map-engraving`}>engraving guide</a> shows how to make the same place as a flat engraving.</p>

  <h2>More examples</h2>
  <ul class="others">
    {#each data.others as other (other.slug)}<li><a href={`${base}${EXAMPLES_HOME}/${other.slug}`}>{other.place}</a></li>{/each}
    <li><a href={`${base}/examples/crater-lake`}>Crater Lake</a></li>
  </ul>
</Article>

<style>
  .others { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 20px; }
</style>
