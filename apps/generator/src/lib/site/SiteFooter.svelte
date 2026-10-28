<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import { ArrowUpRight } from "@lucide/svelte";
  import FeedbackButton from "$lib/site/FeedbackButton.svelte";
  import { REPOSITORY_URL } from "$lib/site/site";
  const base = basePath();
  // The homepage is the reference for this footer. Pages that never hydrate (static) leave out the feedback dialog.
  let { static: plain = false }: { static?: boolean } = $props();
</script>

<footer><span>TopoStack <span class="footer-note">/ Terrain studio</span></span><a href={`${base}/guides`}>Guides</a><a href={`${base}/lakes`}>Lake depth maps</a><a href={`${base}/attribution`}>Sources and attribution</a><a href={`${base}/privacy`}>Privacy</a><a href={`${base}/changelog`}>Changelog</a><a href={REPOSITORY_URL} target="_blank" rel="noopener noreferrer">GitHub<span class="ldt-visually-hidden"> (opens in a new tab)</span></a>{#if !plain}<FeedbackButton />{/if}<a href={`${base}/studio`}>Open terrain studio <ArrowUpRight size={14} aria-hidden="true" /></a></footer>

<style>
  footer { width: min(1120px, calc(100% - 80px)); margin-inline: auto; display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 24px 0 32px; border-top: 1px solid var(--loidolt-border); font: 11px var(--loidolt-font-utility); }
  footer a { display: inline-flex; align-items: center; justify-content: center; gap: 10px; text-decoration: none; }
  footer a, .footer-note { color: var(--loidolt-text-muted); }
  footer a:hover { color: var(--loidolt-text-accent); }
  footer a:focus-visible { outline: 2px solid var(--loidolt-accent); outline-offset: 5px; }
  @media (max-width: 760px) { footer { width: calc(100% - 40px); flex-wrap: wrap; } }
</style>
