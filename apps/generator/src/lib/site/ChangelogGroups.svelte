<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import type { ChangeGroup } from "$lib/site/changelog.server";
  import { REPOSITORY_URL } from "$lib/site/site";
  const base = basePath();
  let { groups }: { groups: ChangeGroup[] } = $props();
</script>

{#each groups as group (group.type)}
  <h3 class="change-group">{group.label}</h3>
  <ul class="changes">
    {#each group.entries as entry, index (index)}
      <li class={`change change-${entry.type}`}>
        <strong>{entry.title}.</strong>
        {#each entry.tokens as token, part (part)}{#if token.kind === "text"}{token.text}{:else if token.kind === "code"}<code>{token.text}</code>{:else if token.kind === "strong"}<strong>{token.text}</strong>{:else}<a href={token.href.startsWith("/") ? `${base}${token.href}` : token.href}>{token.text}</a>{/if}{/each}
        {#if entry.pr}<a class="pr" href={`${REPOSITORY_URL}/pull/${entry.pr}`} aria-label={`Pull request ${entry.pr}`}>#{entry.pr}</a>{/if}
      </li>
    {/each}
  </ul>
{/each}

<style>
  .change-group { display: inline-block; margin: 24px 0 4px; padding: 2px 10px; border-radius: 999px; font: 12px var(--loidolt-font-utility); letter-spacing: 0.06em; text-transform: uppercase; background: var(--loidolt-surface); border: 1px solid var(--loidolt-border); }
  .changes { padding-left: 20px; }
  .pr { margin-left: 4px; font-size: 13px; color: var(--loidolt-text-muted) !important; }
</style>
