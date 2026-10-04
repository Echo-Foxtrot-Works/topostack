<script lang="ts">
  import "@loidolt/theme-styles/core";
  import "@loidolt/theme-styles/dark";
  import Seo from "$lib/site/Seo.svelte";
  import { afterNavigate } from "$app/navigation";
  import { trackPageView } from "$lib/site/usage";
  afterNavigate(({ to }) => { if (to) trackPageView(to.url.pathname); });

  let { children } = $props();
</script>

<Seo />
{@render children()}

<style>
  :global(.ldt-topbar__actions) {
    gap: clamp(var(--loidolt-space-2), 2vw, var(--loidolt-space-6));
  }
</style>
