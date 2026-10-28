<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import Article from "$lib/site/Article.svelte";
  import ChangelogGroups from "$lib/site/ChangelogGroups.svelte";
  import type { PageProps } from "./$types";
  const base = basePath();
  let { data }: PageProps = $props();
</script>

<svelte:head>
  <link rel="alternate" type="application/atom+xml" title="TopoStack changelog" href={`${base}/changelog.xml`} />
</svelte:head>

<Article title="Changelog" intro="New features, improvements and fixes in each TopoStack release, newest first.">
  <p>Subscribe to the <a href={`${base}/changelog.xml`}>changelog feed</a> in any feed reader to hear about new releases, or report a problem from the feedback button at the bottom of any page.</p>
  {#if data.unreleased.length}
    <section>
      <h2 id="unreleased">Unreleased</h2>
      <p class="note">Merged into the development site and waiting for the next release.</p>
      <ChangelogGroups groups={data.unreleased} />
    </section>
  {/if}
  {#each data.releases as release (release.id)}
    <section>
      <h2 id={release.id}>Version {release.version}</h2>
      <p class="release-date"><time datetime={release.date}>{release.displayDate}</time></p>
      <ChangelogGroups groups={release.groups} />
    </section>
  {/each}
</Article>

<style>
  .release-date { margin-top: -8px; color: var(--loidolt-text-muted); font-size: 14px !important; }
</style>
