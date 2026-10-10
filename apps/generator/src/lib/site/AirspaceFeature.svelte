<script lang="ts">
  import { base } from "$app/paths";
  import { ArrowRight } from "@lucide/svelte";
</script>

<div class="airspace-feature">
  <div class="copy">
    <p class="eyebrow">Above the landscape</p>
    <h2 id="airspace-title">Give airspace a<br />new perspective.</h2>
    <p>Build the sky above your terrain. Turn FAA airspace into clear or tinted acrylic shelves, supported on rods at the heights your model represents.</p>
    <p class="detail">Choose open plates, colored tiers, or solid volumes. Preview the stack, then export separate acrylic cut files, rod lengths, and an illustrated assembly guide.</p>
    <div class="actions">
      <a class="primary-link" href={`${base}/guides/airspace-in-3d`}>Make an airspace model <ArrowRight size={17} aria-hidden="true" /></a>
      <a class="guide-link" href={`${base}/guides/airspace-assembly`}>See how it goes together</a>
    </div>
    <p class="coverage">US FAA data · Layered projects · Decorative models, not for navigation</p>
  </div>
  <figure>
    <div class="airspace-linework" role="img" aria-label="Orange line illustration of compact airspace shelves on rods centered above an airport and layered terrain." style={`--airspace-art: url(${base}/images/airspace-relief.svg)`}></div>
    <figcaption>A new view of floors, ceilings, and the land below. Conceptual illustration.</figcaption>
  </figure>
</div>

<style>
  .airspace-feature { display: grid; grid-template-columns: 1fr 1.2fr; align-items: center; gap: 32px; }
  .eyebrow { margin: 0 0 14px; color: var(--loidolt-text-accent); font: 11px var(--loidolt-font-utility); letter-spacing: .12em; text-transform: uppercase; }
  h2 { font-size: clamp(28px, 3.5vw, 42px); font-weight: 550; line-height: 1.15; letter-spacing: -.035em; margin: 0 0 24px; }
  p { font-size: 15px; line-height: 1.75; color: var(--loidolt-text-muted); margin: 0 0 18px; }
  .detail { font-size: 14px; }
  .actions { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 24px; margin-top: 26px; }
  .primary-link { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 48px; padding: 12px 18px; background: var(--loidolt-accent); color: var(--loidolt-on-accent); border-radius: var(--loidolt-border-radius); font-size: 14px; font-weight: 600; text-decoration: none; }
  .primary-link:hover { background: var(--loidolt-accent-hover); }
  .guide-link { min-height: 44px; display: inline-flex; align-items: center; color: var(--loidolt-text); font-size: 13px; text-underline-offset: 4px; }
  a:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 5px; }
  .coverage { font-size: 11px; margin-top: 20px; }
  figure { margin: 0; }
  .airspace-linework { width: min(100%, 460px); aspect-ratio: 46 / 28; margin-inline: auto; background: var(--loidolt-accent); mask: var(--airspace-art) center / contain no-repeat; }
  figcaption { text-align: center; color: var(--loidolt-text-muted); font: 11px var(--loidolt-font-utility); line-height: 1.6; margin-top: 12px; }
  @media (max-width: 760px) { .airspace-feature { grid-template-columns: 1fr; gap: 24px; } figure { max-width: 580px; } }
</style>
