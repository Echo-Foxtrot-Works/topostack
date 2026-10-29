<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import { exampleStudioPath } from "$lib/site/site";
  const base = basePath();

  /** `download` is the published project file; Crater Lake has none because it is the studio's starting project. */
  let { slug, download = false }: { slug: string; download?: boolean } = $props();
</script>

<p class="example-actions">
  <a class="open" href={`${base}${exampleStudioPath(slug)}`}>Open in studio</a>
  {#if download}<a class="download" href={`${base}/examples/${slug}.json`} download>Download the project file</a>{/if}
</p>

<style>
  .example-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; margin-block: 24px; }
  .example-actions a { display: inline-flex; align-items: center; min-height: 44px; padding: 10px 18px; border-radius: var(--loidolt-border-radius); text-decoration: none; font-size: 15px; font-weight: 600; }
  .example-actions .open { background: var(--loidolt-accent); color: var(--loidolt-on-accent); }
  .example-actions .download { border: 1px solid var(--loidolt-border); color: var(--loidolt-text-accent); }
  .example-actions .download:hover { border-color: var(--loidolt-accent); }
</style>
