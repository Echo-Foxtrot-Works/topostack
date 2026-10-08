<script lang="ts">
  import WaterFinishComparison from "$lib/site/WaterFinishComparison.svelte";
  import SiteHeader from "$lib/site/SiteHeader.svelte";
  import SiteFooter from "$lib/site/SiteFooter.svelte";
  import { base } from "$app/paths";
  import { ArrowRight, ArrowUpRight, Heart, Star } from "@lucide/svelte";
  import { donationUrl } from "$lib/site/support";
  import { REPOSITORY_URL } from "$lib/site/site";
  import { MAP_DATA_ATTRIBUTION } from "$lib/domain/map-attribution";
  import TerrainIllustration from "$lib/studio/TerrainIllustration.svelte";
  import { STARTERS } from "$lib/site/starters";

  const atommBuild = import.meta.env.VITE_SITE_ENV === "atomm";

  const studioUrl = `${base}/studio`;
</script>

{#if atommBuild}
  {#await import("./studio/+page.svelte")}<main class="atomm-startup" role="status">Preparing terrain studio…</main>{:then studio}<studio.default />{:catch}<main class="atomm-startup" role="alert">The studio could not load. Reload to try again.</main>{/await}
{:else}
<div class="landing-page">
  <SiteHeader content="landing-content" home />

  <main id="landing-content">
    <section class="hero" aria-labelledby="landing-title">
      <div class="hero-copy">
        <p class="eyebrow">Real terrain. Ready to make.</p>
        <h1 id="landing-title">Turn real terrain into <span>laser-cut topographic maps.</span></h1>
        <p class="intro">A place you love. A thing you make. Create layered terrain reliefs and flat topographic engravings from real elevation data, then export SVG files for your laser software.</p>
        <div class="hero-actions">
          <a class="primary-link" href={studioUrl}>Start creating <ArrowRight size={18} aria-hidden="true" /></a>
          <a class="secondary-link" href="#first-project">Choose a first project</a>
          <a class="secondary-link" href="#how-it-works">See how it works</a>
        </div>
        <p class="cta-note">Free to use · No account required · SVG exports · Step-by-step assembly guide</p>
      </div>
      <figure class="terrain-art">
        <TerrainIllustration variant="hero" />
        <figcaption>Inspired by the landscape. Made by you.</figcaption>
      </figure>
    </section>

    <section id="first-project" class="section" aria-labelledby="first-project-title">
      <div class="section-heading"><p class="eyebrow">A place to begin</p><h2 id="first-project-title">Choose your first project.</h2><p>Start with prepared Crater Lake settings, review your size and material, then generate and export. You can undo back to your previous design.</p></div>
      <div class="starter-grid">
        {#each STARTERS as starter (starter.id)}
          <article class="starter-card"><h3>{starter.title}</h3><p>{starter.description}</p><p class="card-detail">{starter.size}</p><a class="primary-link" href={`${studioUrl}?starter=${starter.id}`}>Start {starter.title.toLowerCase()} <ArrowRight size={16} aria-hidden="true" /></a></article>
        {/each}
      </div>
    </section>

    <section class="workflows section" aria-labelledby="workflows-title">
      <div class="section-heading"><p class="eyebrow">Two ways to make it</p><h2 id="workflows-title">Same landscape. Your kind of project.</h2></div>
      <div class="workflow-grid">
        <article class="workflow-card">
          <div class="workflow-art"><TerrainIllustration variant="relief" /></div>
          <h3>Layered relief</h3>
          <p>Build terrain one sheet at a time. Elevation becomes a stack of contours, sized for your material thickness and the relief you want to show.</p>
          <p class="card-detail">Cut panels, engraving companions, and an illustrated, step-by-step assembly guide take your project from preview to finished piece.</p>
          <span class="format">Cut · Score · Engrave</span>
          <a class="secondary-link" href={`${base}/guides/laser-cut-topographic-map`}>How to make a layered topographic map</a>
        </article>
        <article class="workflow-card">
          <div class="workflow-art"><TerrainIllustration variant="engraving" /></div>
          <h3>Flat engraving</h3>
          <p>Let the contours do the drawing. Create a topographic map on a single surface, with control over contour density and the details you include.</p>
          <p class="card-detail">Export one SVG at your chosen physical size, with optional roads, trails, water, labels, a compass, and a scale bar.</p>
          <span class="format">One surface · Engrave-only SVG</span>
          <a class="secondary-link" href={`${base}/guides/topographic-map-engraving`}>Create a contour map for engraving</a>
        </article>
      </div>
    </section>

    <section id="water-finishes" class="section" aria-labelledby="water-finishes-title">
      <div class="section-heading"><p class="eyebrow">Water, made your way</p><h2 id="water-finishes-title">Two ways to finish your lake.</h2><p>Color the wooden lake bed, or add a fitted acrylic surface. Both finishes start with the same layered terrain.</p></div>
      <WaterFinishComparison links linework />
    </section>

    <section id="how-it-works" class="section process" aria-labelledby="process-title">
      <div class="section-heading"><p class="eyebrow">From map to material</p><h2 id="process-title">Find it. Shape it. Make it.</h2><p>Start with the Crater Lake preview, then make a place your own.</p><div class="section-art"><TerrainIllustration variant="location" /></div></div>
      <div class="process-guide">
      <ol class="steps">
        <li><span class="step-number">01</span><div><h3>Choose a place</h3><p>Search for a location or enter coordinates, then frame the area you want to capture.</p></div></li>
        <li><span class="step-number">02</span><div><h3>Make it yours</h3><p>Choose layered relief or flat engraving. Set your output size, adjust the terrain, and add the map details that matter to you.</p></div></li>
        <li><span class="step-number">03</span><div><h3>Generate and export</h3><p>Generate fresh terrain, review the preview, and download your files for your laser software, with an illustrated assembly guide for layered reliefs. You can also use TopoStack through Atomm.</p></div></li>
      </ol>
      <a class="primary-link process-cta" href={studioUrl}>Try the terrain studio <ArrowRight size={18} aria-hidden="true" /></a>
      </div>
    </section>

    <section id="assembly-guide" class="section guide-feature" aria-labelledby="guide-title">
      <div class="section-heading">
        <p class="eyebrow">First build? You've got this</p>
        <h2 id="guide-title">Every layered relief comes with a step-by-step assembly guide.</h2>
        <p>Cutting the layers is only half the job. Your export includes an illustrated booklet that takes you from the first sheet off the laser to the last layer glued down.</p>
        <div class="section-art"><TerrainIllustration variant="guide" /></div>
      </div>
      <div>
        <ul class="steps">
          <li><span class="step-number">01</span><div><h3>A checklist for every sheet</h3><p>Tick off each file as it comes off the laser, with the layers each sheet holds.</p></div></li>
          <li><span class="step-number">02</span><div><h3>One picture per layer</h3><p>See the stack so far with the new layer highlighted, so you always know where it goes. Small pieces are circled.</p></div></li>
          <li><span class="step-number">03</span><div><h3>Only what is new at each step</h3><p>The gluing routine is explained once. Each step adds what is particular to its layer: which sheet the pieces come from, ids for pieces cut in parts, cutouts nested in other sheets, and what to paint first.</p></div></li>
          <li><span class="step-number">04</span><div><h3>Print it or keep it open</h3><p>Three steps to a Letter page, or follow along on a tablet at the bench. It works offline.</p></div></li>
        </ul>
        <a class="secondary-link process-cta" href={`${base}/guides/export-files`}>See everything in the export <ArrowRight size={16} aria-hidden="true" /></a>
      </div>
    </section>

    <section class="section" aria-labelledby="example-title">
      <div class="section-heading"><p class="eyebrow">Inside the studio</p><h2 id="example-title">Explore the Crater Lake terrain preview</h2><p>See how real elevation becomes a stack of contours. Follow the example, then generate fresh terrain to create your own fabrication files.</p></div>
      <figure class="studio-example"><picture><source type="image/webp" srcset={`${base}/images/studio-crater-lake-640.webp 640w, ${base}/images/studio-crater-lake.webp 1280w`} sizes="(max-width: 720px) 100vw, 1280px" /><img src={`${base}/images/studio-crater-lake.png`} width="1280" height="900" loading="lazy" decoding="async" alt="TopoStack studio with freshly generated Crater Lake terrain and USGS surveyed lake-floor relief." /></picture><figcaption>Crater Lake with USGS surveyed bathymetry where available. Gaps use existing terrain or modeled depths; depth is exaggerated.</figcaption></figure>
      <div class="example-links"><a class="secondary-link" href={`${base}/examples/crater-lake`}>Follow the Crater Lake project <ArrowRight size={16} aria-hidden="true" /></a><a class="secondary-link" href={`${base}/examples`}>More examples: Grand Canyon, Mount Fuji and others <ArrowRight size={16} aria-hidden="true" /></a></div>
    </section>

    <section class="section details-section" aria-labelledby="details-title">
      <div class="section-heading"><p class="eyebrow">Behind the contours</p><h2 id="details-title">Real terrain, with a little context.</h2><div class="section-art"><TerrainIllustration variant="data" /></div></div>
      <div class="details-copy">
        <h3>Built on shared map data</h3>
        <p>TopoStack combines Mapzen elevation tiles with Protomaps and OpenStreetMap features. HydroLAKES and GLOBathy support lake detail. Exported projects include source attribution.</p>
        <details>
          <summary>View data sources and credits</summary>
          <ul class="source-list">
            {#each MAP_DATA_ATTRIBUTION as source}
              <li><a href={source.url} target="_blank" rel="noopener noreferrer">{source.name}<span class="ldt-visually-hidden"> (opens in a new tab)</span></a><small>{source.license}</small></li>
            {/each}
          </ul>
        </details>
        <p><a class="secondary-link" href={`${base}/attribution`}>All sources, uses, and attribution <ArrowRight size={16} aria-hidden="true" /></a></p>
        <h3>Your project, in your browser</h3>
        <p>Project settings are saved in this browser. Export a project-settings JSON file to keep a backup or move your settings to another device. Place search and map data require an internet connection.</p>
        <p class="data-note">Terrain and map data are intended for decorative projects, not surveying, navigation, or engineering. Review the exported artwork and your machine settings before fabrication.</p>
      </div>
    </section>

    <section id="open-source" class="section open-source" aria-labelledby="open-source-title">
      <div class="section-heading">
        <p class="eyebrow">Built in the open</p>
        <h2 id="open-source-title">Open source.<br />Built with AI.</h2>
      </div>
      <div class="source-copy">
        <p>TopoStack is my spare-time project. I’m a solo developer, and AI helps me turn ideas into working software and make the most of the time I have.</p>
        <p>The code is open source, so you can explore how it works, follow its development, and help make it better.</p>
        <p>Found a bug or have an idea? I’d love to hear it.</p>
        <div class="source-actions">
          <a class="support-link star-link" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer"><Star size={16} aria-hidden="true" /> Star TopoStack on GitHub <ArrowUpRight size={16} aria-hidden="true" /><span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
          <a class="secondary-link" href={`${REPOSITORY_URL}/issues`} target="_blank" rel="noopener noreferrer">Report a bug or share an idea<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
        </div>
      </div>
    </section>

    <section class="start-panel" aria-labelledby="start-title">
      <div><p class="eyebrow">Your landscape is waiting</p><h2 id="start-title">Make something from somewhere.</h2><p>Pick a place, explore its contours, and turn it into your next project.</p></div>
      <a class="primary-link" href={studioUrl}>Start creating <ArrowRight size={18} aria-hidden="true" /></a>
    </section>

    <section class="section" aria-labelledby="questions-title">
      <div class="section-heading"><h2 id="questions-title">Before your first map</h2></div>
      <details><summary>Is TopoStack free, and do I need an account?</summary><p>TopoStack is free to use with no account required. Donations are optional, and every export is available without donating.</p></details>
      <details><summary>What files can I export?</summary><p>Layered projects include SVG cut panels, engraving companions and a printable, step-by-step assembly guide. Flat engraving produces one SVG at your chosen physical size. Both workflows support a project-settings JSON backup.</p></details>
      <details><summary>Can I cut the initial Crater Lake preview?</summary><p>Generate fresh terrain first. The bundled preview lets you explore the controls; fabrication export requires current real terrain and all requested map data.</p></details>
      <details><summary>Where is my project saved?</summary><p>Settings are saved in this browser. Export a settings backup before clearing browser storage or moving devices. Imported and restored settings need fresh generation before fabrication export.</p></details>
    </section>

    <section class="support" aria-labelledby="support-title">
      <div><p class="eyebrow">Keep the contours coming</p><h2 id="support-title">Support TopoStack</h2><p>If TopoStack helps you make something meaningful, consider supporting its development. Donations are optional; every export is available without donating.</p></div>
      <a class="support-link" href={donationUrl} target="_blank" rel="noopener noreferrer"><Heart size={17} aria-hidden="true" /> Make a donation <ArrowUpRight size={16} aria-hidden="true" /><span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
    </section>
  </main>

  <SiteFooter />
</div>

{/if}

<style>
  .atomm-startup { min-height: 100dvh; display: grid; place-content: center; background: var(--loidolt-surface); color: var(--loidolt-text); }
  .landing-page { min-height: 100dvh; background: var(--loidolt-background); color: var(--loidolt-text); }
  .secondary-link, .primary-link, .support-link { display: inline-flex; align-items: center; justify-content: center; gap: 10px; text-decoration: none; }
  .star-link :global(svg:first-child) { transition: fill 160ms ease, color 160ms ease; }
  .star-link:hover :global(svg:first-child), .star-link:focus-visible :global(svg:first-child) { color: var(--loidolt-text-accent); fill: currentColor; }
  #first-project, #how-it-works, #assembly-guide, #water-finishes, #open-source { scroll-margin-top: 100px; }
  .hero-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 16px 24px; }
  .secondary-link { min-height: 48px; color: var(--loidolt-text); font-size: 13px; text-decoration: underline; text-underline-offset: 4px; }
  .cta-note { margin: 16px 0 0; font-size: 12px; }
  .process-cta { margin-top: 28px; }
  .start-panel { display: flex; align-items: center; justify-content: space-between; gap: 36px; padding: 42px 36px; margin-bottom: 24px; border: 1px solid var(--loidolt-accent); background: var(--loidolt-surface); border-radius: var(--loidolt-border-radius); }
  .start-panel h2 { margin-bottom: 12px; }
  .start-panel p:last-child { margin-bottom: 0; }
  .start-panel .primary-link { flex-shrink: 0; }
  a:focus-visible, summary:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 5px; }
  a:hover { color: var(--loidolt-text-accent); }
  main { width: min(1120px, calc(100% - 80px)); margin-inline: auto; }
  .hero { display: grid; grid-template-columns: 1.15fr 1fr; align-items: center; gap: 40px; padding: 80px 0 72px; }
  .eyebrow, .format, .step-number { font: 11px var(--loidolt-font-utility); letter-spacing: 0.12em; text-transform: uppercase; color: var(--loidolt-text-accent); }
  .eyebrow { margin: 0 0 22px; }
  h1, h2, h3, p { margin-top: 0; }
  h1 { font-size: clamp(36px, 4.5vw, 58px); line-height: 1.09; letter-spacing: -0.045em; margin-bottom: 25px; font-weight: 600; }
  h1 span { color: var(--loidolt-text-muted); }
  .studio-example { margin: 24px 0; }
  .example-links { display: flex; flex-wrap: wrap; gap: 0 28px; }
  .studio-example img { display: block; width: 100%; height: auto; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); }
  p { font-size: 15px; line-height: 1.75; color: var(--loidolt-text-muted); }
  .intro { max-width: 480px; font-size: 17px; margin-bottom: 30px; }
  .primary-link { background: var(--loidolt-accent); color: var(--loidolt-on-accent); min-height: 50px; padding: 15px 24px; border-radius: var(--loidolt-border-radius); font-size: 15px; font-weight: 600; }
  .primary-link:hover { background: var(--loidolt-accent-hover); color: var(--loidolt-on-accent); }
  .terrain-art { margin: 0; color: var(--loidolt-text-accent); }
  figcaption { text-align: center; font: 11px var(--loidolt-font-utility); color: var(--loidolt-text-muted); margin-top: 20px; }
  .section { padding: 56px 0; border-top: 1px solid var(--loidolt-border); }
  .section-heading .eyebrow { margin-bottom: 14px; }
  h2 { font-size: clamp(25px, 3vw, 32px); line-height: 1.2; letter-spacing: -0.025em; font-weight: 550; margin-bottom: 26px; }
  h3 { font-size: 19px; font-weight: 550; line-height: 1.3; margin-bottom: 12px; }
  .workflow-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .starter-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 20px; }
  .starter-card { display: flex; flex-direction: column; padding: 24px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); background: var(--loidolt-surface); }
  .starter-card .primary-link { margin-top: auto; font-size: 13px; padding-inline: 12px; }
  @media (max-width: 900px) { .starter-grid { grid-template-columns: 1fr; } }
  .workflow-card { padding: 30px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); background: var(--loidolt-surface); }
  .workflow-art { max-width: 400px; margin: 0 auto 30px; }
  .section-art { max-width: 400px; margin: 32px auto 0; }
  .workflow-card h3 { font-size: 23px; }
  .card-detail { margin-bottom: 26px; }
  .format { display: block; padding-top: 20px; border-top: 1px solid var(--loidolt-border); font-size: 10px; }
  .process, .guide-feature, .details-section, .open-source { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 80px; }
  .source-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 24px; margin-top: 24px; }
  .source-actions .support-link { flex-shrink: 1; }
  .steps { list-style: none; padding: 0; margin: 0; }
  .steps li { display: flex; gap: 24px; }
  .steps li + li { margin-top: 22px; }
  .step-number { padding-top: 5px; }
  .steps p { margin-bottom: 0; }
  details { margin: 20px 0 30px; border-block: 1px solid var(--loidolt-border); }
  summary { padding: 16px 0; cursor: pointer; font-size: 13px; }
  .source-list { padding: 0 0 8px; list-style: none; }
  .source-list li { padding: 10px 0; }
  .source-list a { font-size: 13px; color: var(--loidolt-text-accent); text-underline-offset: 3px; }
  .source-list small { display: block; font-size: 12px; line-height: 1.6; color: var(--loidolt-text-muted); margin-top: 4px; }
  .data-note { border-left: 2px solid var(--loidolt-border); padding-left: 18px; margin-top: 24px; font-size: 13px; }
  .support { display: flex; align-items: center; gap: 50px; justify-content: space-between; padding: 36px; background: var(--loidolt-surface); border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); margin: 0 0 56px; }
  .support .eyebrow { margin-bottom: 12px; }
  .support h2 { margin-bottom: 14px; }
  .support p:last-child { max-width: 650px; margin: 0; }
  .support-link { flex-shrink: 0; border: 1px solid var(--loidolt-border); padding: 14px 18px; color: var(--loidolt-text); font-size: 13px; border-radius: var(--loidolt-border-radius); }
  @media (max-width: 760px) {
    main { width: calc(100% - 40px); }
    .hero { grid-template-columns: 1fr; gap: 24px; padding: 48px 0 40px; }
    .hero-copy { max-width: 560px; }
    .terrain-art { width: min(360px, 100%); margin-inline: auto; }
    .workflow-grid, .process, .guide-feature, .details-section, .open-source { grid-template-columns: 1fr; gap: 24px; }
    .section { padding: 36px 0; }
    .workflow-card { padding: 24px; }
    .section-art { max-width: 340px; margin-top: 24px; }
    .support { flex-direction: column; align-items: flex-start; gap: 24px; padding: 24px; margin-bottom: 36px; }
    .start-panel { flex-direction: column; align-items: flex-start; padding: 28px 24px; gap: 24px; }
    .hero-actions .primary-link, .start-panel .primary-link { width: 100%; }
  }
</style>
