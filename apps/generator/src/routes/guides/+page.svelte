<script lang="ts">
  import { base } from "$app/paths";
  import Article from "$lib/site/Article.svelte";
  import { DOCS_NAV } from "$lib/site/docs";
</script>

<Article title="Guides" intro="Everything you need to turn real terrain into a finished piece: step-by-step workflows, airspace in acrylic, how terrain and lake depths are built, and where the map data comes from.">
  {#each DOCS_NAV as group (group.id)}
    <section id={group.id} aria-labelledby={`${group.id}-title`}>
      <h2 id={`${group.id}-title`}>{group.title}</h2>
      <p class="summary">{group.summary}</p>
      <ul class="cards">
        {#each group.links as entry (entry.path)}
          <li><a href={`${base}${entry.path}`}><strong>{entry.label}</strong><span>{entry.description}</span></a></li>
        {/each}
      </ul>
    </section>
  {/each}
  <p class="note">Can’t find what you need? Use the feedback button below to ask a question or suggest a guide.</p>
</Article>

<style>
  .summary { color: var(--loidolt-text-muted); }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; list-style: none; padding: 0; }
  .cards li { margin: 0; padding: 0; }
  .cards a { display: flex; flex-direction: column; gap: 6px; height: 100%; box-sizing: border-box; padding: 16px 18px; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); text-decoration: none; }
  .cards a:hover { border-color: var(--loidolt-accent); }
  .cards strong { font-size: 16px; }
  .cards span { font-size: 14px; line-height: 1.6; color: var(--loidolt-text-muted); }
  .note { margin-top: 48px; }
</style>
