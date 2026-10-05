<script lang="ts">
  import { base } from "$app/paths";
  import { ArrowRight, Star } from "@lucide/svelte";
  import { Brand, SkipLink, ThemeToggle, Topbar } from "@loidolt/theme-svelte";
  import { theme } from "$lib/site/theme";
  import { REPOSITORY_URL } from "$lib/site/site";
  // The homepage is the reference for this header; every other public page reuses it.
  // `home` keeps the section link on-page; `static` pages never hydrate, so they skip the theme toggle.
  let { meta = "Studio", content, home = false, static: plain = false }: { meta?: string; content: string; home?: boolean; static?: boolean } = $props();
</script>

<SkipLink targetId={content} label="Skip to content" />
<Topbar class="site-topbar">
  {#snippet brand()}<Brand name="TopoStack" {meta} href={`${base}/`} />{/snippet}
  {#snippet actions()}
    <a class="header-guide" href={home ? "#how-it-works" : `${base}/#how-it-works`}>How it works</a>
    <a class="header-guide" href={`${base}/guides`}>Guides</a>
    <a class="header-guide star-link" href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer"><Star size={13} aria-hidden="true" /> Star on GitHub<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
    <a class="header-cta" href={`${base}/studio`}>Start creating <ArrowRight size={16} aria-hidden="true" /></a>
    {#if !plain}<ThemeToggle {theme} label="Color scheme" />{/if}
  {/snippet}
</Topbar>

<style>
  :global(.site-topbar) { position: sticky; top: 0; z-index: 20; padding-inline: clamp(20px, 5vw, 80px); border-bottom: 1px solid var(--loidolt-border); }
  .header-guide { color: var(--loidolt-text-muted); font: 12px var(--loidolt-font-utility); text-decoration: none; }
  .header-guide.star-link { display: none; align-items: center; gap: 6px; }
  @media (min-width: 1100px) { .header-guide.star-link { display: inline-flex; } }
  .star-link :global(svg:first-child) { transition: fill 160ms ease, color 160ms ease; }
  .star-link:hover :global(svg:first-child), .star-link:focus-visible :global(svg:first-child) { color: var(--loidolt-text-accent); fill: currentColor; }
  .header-cta { display: inline-flex; align-items: center; justify-content: center; gap: 10px; min-height: 42px; padding: 10px 16px; background: var(--loidolt-accent); color: var(--loidolt-on-accent); border-radius: var(--loidolt-border-radius); font-size: 13px; font-weight: 600; text-decoration: none; }
  a:hover { color: var(--loidolt-text-accent); }
  .header-cta:hover { background: var(--loidolt-accent-hover); color: var(--loidolt-on-accent); }
  a:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 5px; }
  @media (max-width: 760px) {
    .header-guide { display: none; }
    .header-cta { font-size: 12px; padding-inline: 12px; gap: 8px; }
    :global(.site-topbar .ldt-brand__meta) { display: none; }
    :global(.site-topbar) { flex-wrap: nowrap; }
    :global(.site-topbar .ldt-topbar__actions) { width: auto; margin-left: auto; }
  }
</style>
