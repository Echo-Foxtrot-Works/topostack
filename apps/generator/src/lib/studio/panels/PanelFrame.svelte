<script lang="ts">
  import { ChevronDown } from "@lucide/svelte";
  import { Section } from "@loidolt/theme-svelte";
  import type { Snippet } from "svelte";
  import type { DisclosureId } from "$lib/studio/preview-summary";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * One settings panel. In the standalone studio it is the body of a rail tab
   * (`SettingsRail.svelte`); the platform embed has no rail, so there each
   * panel is a disclosure styled by the platform's own section rules.
   */
  let { id, title, class: className = "", disclosure = false, children }: {
    id: DisclosureId;
    title: string;
    class?: string;
    /** Always render as a disclosure, for the embed's lead rail. */
    disclosure?: boolean;
    children: Snippet;
  } = $props();
  const studio = getStudio();
  const asDisclosure = $derived(disclosure || studio.embeddedInPlatform);
</script>

{#if asDisclosure}
  <Section class={`config-section ${className}`} aria-labelledby={`panel-${id}-title`}>
    <button type="button" class="section-disclosure" id={`panel-${id}-title`} aria-expanded={studio.openPanels[id]} aria-controls={`panel-${id}`} onclick={() => studio.togglePanel(id)}>
      <span class="section-title">{title}<small>{studio.panelSummary(id)}</small></span>
      <ChevronDown size={16} class={studio.openPanels[id] ? "kicker-chevron kicker-chevron--open" : "kicker-chevron"} />
    </button>
    <div id={`panel-${id}`} class="section-content" data-panel={id} hidden={!studio.openPanels[id]}>{@render children()}</div>
  </Section>
{:else}
  <!-- Inside the rail's tab panel, which shows and hides it. -->
  <div id={`panel-${id}`} class={`studio-panel ${className}`} data-panel={id}>
    <header class="studio-panel-header">
      <h2>{title}</h2>
      <small>{studio.panelSummary(id)}</small>
    </header>
    <div class="section-content">{@render children()}</div>
  </div>
{/if}
