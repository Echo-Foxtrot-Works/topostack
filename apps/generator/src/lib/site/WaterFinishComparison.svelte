<script lang="ts">
  import { base } from "$app/paths";
  let { links = false, linework = false }: { links?: boolean; linework?: boolean } = $props();
</script>

<div class="water-finishes">
  <figure>
    {#if linework}
      <div class="water-linework" role="img" aria-label="Orange line illustration of a paper stencil above a stepped wooden lake bed." style={`--water-art: url(${base}/images/illustrations/water-painted-wood.svg)`}></div>
    {:else}
      <img src={`${base}/images/guides/water-painted-wood-800.webp`} srcset={`${base}/images/guides/water-painted-wood-400.webp 400w, ${base}/images/guides/water-painted-wood-800.webp 800w, ${base}/images/guides/water-painted-wood-1200.webp 1200w`} sizes="(max-width: 600px) calc(100vw - 40px), (max-width: 900px) 44vw, 560px" width="800" height="800" loading="lazy" decoding="async" alt="Illustration of blue-painted wooden lake-bed steps and a paper stencil masking the surrounding land." />
    {/if}
    <figcaption>
      <h3>Painted wood</h3>
      <p>Keep the lake in wood and paint or stain the exposed steps. Turn on <strong>Water paint templates</strong> to export a stencil for each panel with visible water, then paint before gluing.</p>
      {#if links}<a href={`${base}/guides/water-paint-templates`}>How to use water paint templates</a>{/if}
    </figcaption>
  </figure>
  <figure>
    {#if linework}
      <div class="water-linework" role="img" aria-label="Orange line illustration of an acrylic lake insert lowering onto a wooden support ledge." style={`--water-art: url(${base}/images/illustrations/water-acrylic-inserts.svg)`}></div>
    {:else}
      <img src={`${base}/images/guides/water-acrylic-inserts-800.webp`} srcset={`${base}/images/guides/water-acrylic-inserts-400.webp 400w, ${base}/images/guides/water-acrylic-inserts-800.webp 800w, ${base}/images/guides/water-acrylic-inserts-1200.webp 1200w`} sizes="(max-width: 600px) calc(100vw - 40px), (max-width: 900px) 44vw, 560px" width="800" height="800" loading="lazy" decoding="async" alt="Illustration of clear blue acrylic over a wooden lake bed and a separate insert lowering onto its support ledge." />
    {/if}
    <figcaption>
      <h3>Acrylic inserts</h3>
      <p>Turn on <strong>Acrylic water inserts</strong> to cut a fitted piece for each lake at its waterline. Cut the acrylic as a separate job, then fit it onto the support ledge using the assembly guide.</p>
      {#if links}<a href={`${base}/guides/export-files#water-finishes-and-their-files`}>See the acrylic export files</a>{/if}
    </figcaption>
  </figure>
</div>
<p class="water-finish-note">You can combine both finishes: paint the lake bed before fitting clear acrylic over it. Illustrations show the finishes and assembly; your exported shapes follow your project.</p>

<style>
  .water-finishes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; }
  .water-finishes figure { margin: 0; min-width: 0; }
  .water-finishes img { display: block; width: 100%; height: auto; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); }
  .water-linework { width: min(100%, 460px); aspect-ratio: 46 / 28; margin-inline: auto; background: var(--loidolt-accent); mask: var(--water-art) center / contain no-repeat; }
  .water-finishes figcaption { margin: 18px 0 0; text-align: left; font: inherit; }
  .water-finishes h3 { margin: 0 0 10px; font-size: 21px; line-height: 1.3; font-weight: 550; color: var(--loidolt-text); }
  .water-finishes p { margin: 0 0 12px; font-size: 15px; line-height: 1.75; color: var(--loidolt-text-muted); }
  .water-finishes a { color: var(--loidolt-text-accent); font-size: 14px; line-height: 1.6; text-underline-offset: 4px; }
  .water-finishes a:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 4px; }
  .water-finish-note { margin: 24px 0 0; font-size: 14px; line-height: 1.7; color: var(--loidolt-text-muted); }
  @media (max-width: 600px) { .water-finishes { grid-template-columns: 1fr; gap: 32px; } }
</style>
