<script lang="ts">
  import { base } from "$app/paths";
  import { relatedContent } from "$lib/site/related-content";
  let { path }: { path: string } = $props();
  const links = $derived(relatedContent(path));
</script>

{#if links.length}
  <section class="related-content" aria-label="Continue your project">
    <h2>Continue your project</h2>
    <div class="related-grid">
      {#each links as link (link.path)}<a href={`${base}${link.path}`}><h3>{link.title}</h3><p>{link.description}</p></a>{/each}
    </div>
  </section>
{/if}

<style>
  .related-content { margin-top: 40px; }
  h2 { font-size: 23px; margin-bottom: 18px; }
  .related-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  a { padding: 18px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); text-decoration: none; }
  a:hover { border-color: var(--loidolt-accent); }
  h3 { font-size: 15px; line-height: 1.45; margin: 0 0 8px; }
  p { font-size: 13px; line-height: 1.65; color: var(--loidolt-text-muted); margin: 0; }
  @media (max-width: 700px) { .related-grid { grid-template-columns: 1fr; } }
</style>
