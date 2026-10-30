<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import { onMount } from "svelte";
  import { Ellipsis } from "@lucide/svelte";
  import type { ThemePreference } from "@loidolt/theme-svelte";
  import { DOCS_HOME } from "$lib/site/site";
  import { theme } from "$lib/site/theme";
  import HeaderMenu from "$lib/studio/panels/HeaderMenu.svelte";
  import { LATEST_VERSION as version, hasUnseenRelease, markReleaseSeen } from "$lib/studio/whats-new";
  const base = basePath();

  // The Atomm build has no public changelog page to link to.
  const showWhatsNew = import.meta.env.VITE_SITE_ENV !== "atomm";
  // Rows are text only: every lucide icon lands in the shared UI chunk the
  // homepage preloads, so the menu reuses none beyond its trigger.
  const schemes: { value: ThemePreference; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  let unseen = $state(false);
  onMount(() => { if (showWhatsNew) unseen = hasUnseenRelease(localStorage, version); });
  const menuLabel = $derived(`Studio menu${unseen ? " (new release)" : ""}`);
</script>

<HeaderMenu label={menuLabel} title="Color scheme, guides and what's new" triggerClass="ldt-button ldt-icon-button ldt-button--ghost studio-menu-trigger">
  {#snippet trigger()}<Ellipsis size={18} aria-hidden="true" />{#if unseen}<span class="whats-new-dot" aria-hidden="true"></span>{/if}{/snippet}
  <div class="ldt-menu__label" role="presentation">Color scheme</div>
  {#each schemes as scheme (scheme.value)}
    <button type="button" class="ldt-menu__item studio-menu__scheme" role="menuitemradio" aria-checked={theme.preference === scheme.value} onclick={() => { theme.preference = scheme.value; }}>{scheme.label}</button>
  {/each}
  <hr class="ldt-menu__separator" />
  {#if showWhatsNew}
    <a class="ldt-menu__item" role="menuitem" href={`${base}/changelog`} target="_blank" rel="noopener noreferrer" onclick={() => { markReleaseSeen(localStorage, version); unseen = false; }}>
      <span class="studio-menu__row">What's new{#if unseen}<span class="studio-menu__badge">New</span>{/if}</span><span class="ldt-visually-hidden"> (opens in a new tab)</span>
    </a>
  {/if}
  <a class="ldt-menu__item" role="menuitem" href={`${base}${DOCS_HOME}`} target="_blank" rel="noopener noreferrer">Guides<span class="ldt-menu__hint" aria-hidden="true">↗</span><span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
  <a class="ldt-menu__item" role="menuitem" href={`${base}/`} target="_blank" rel="noopener noreferrer">TopoStack home<span class="ldt-menu__hint" aria-hidden="true">↗</span><span class="ldt-visually-hidden"> (opens in a new tab)</span></a>
  <hr class="ldt-menu__separator" />
  <div class="studio-menu__version" role="presentation">TopoStack v{version}</div>
</HeaderMenu>
