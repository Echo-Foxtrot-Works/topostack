<script lang="ts">
  import { MapPin, Mountain, Plane, Route, Type, Waves, Wrench } from "@lucide/svelte";
  import { Tabs, type TabItem } from "@loidolt/theme-svelte";
  import { MediaQuery } from "svelte/reactivity";
  import { PANEL_IDS, PANEL_LABELS, type PanelId } from "$lib/studio/preview-summary";
  import AviationPanel from "$lib/studio/panels/AviationPanel.svelte";
  import FeaturesPanel from "$lib/studio/panels/FeaturesPanel.svelte";
  import LabelsPanel from "$lib/studio/panels/LabelsPanel.svelte";
  import MakePanel from "$lib/studio/panels/MakePanel.svelte";
  import PlacePanel from "$lib/studio/panels/PlacePanel.svelte";
  import SettingsSearch from "$lib/studio/panels/SettingsSearch.svelte";
  import TerrainPanel from "$lib/studio/panels/TerrainPanel.svelte";
  import WaterPanel from "$lib/studio/panels/WaterPanel.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * The standalone studio's settings: a rail of panels, one shown at a time,
   * with the settings search pinned above them. Every panel stays mounted, so
   * hidden controls keep their state and the search can find them. Where the
   * workspace stacks (the breakpoint in responsive.css), the rail becomes a
   * row of tabs above the panel.
   */
  const studio = getStudio();
  // Without matchMedia (a test DOM) the rail stays vertical.
  const stacked = typeof matchMedia === "function" ? new MediaQuery("(max-width: 1000px), (max-width: 1100px) and (orientation: portrait)", false) : undefined;
  let panels = $state<HTMLElement | null>(null);
</script>

{#snippet place()}<MapPin strokeWidth={1.8} />{/snippet}
{#snippet terrain()}<Mountain strokeWidth={1.8} />{/snippet}
{#snippet features()}<Route strokeWidth={1.8} />{/snippet}
{#snippet water()}<Waves strokeWidth={1.8} />{/snippet}
{#snippet aviation()}<Plane strokeWidth={1.8} />{/snippet}
{#snippet labels()}<Type strokeWidth={1.8} />{/snippet}
{#snippet make()}<Wrench strokeWidth={1.8} />{/snippet}

<Tabs
  class="settings-rail"
  variant="rail"
  orientation={stacked?.current ? "horizontal" : "vertical"}
  label="Settings panels"
  panelsClass="settings-panels"
  bind:value={studio.activePanel}
  onValueChange={() => panels?.closest(".ldt-tabs__panels")?.scrollTo?.({ top: 0 })}
  tabs={PANEL_IDS.map((panel): TabItem<PanelId> => ({ value: panel, label: PANEL_LABELS[panel], icon: { place, terrain, features, water, aviation, labels, make }[panel], description: studio.panelSummary(panel) }))}
>
  {#snippet panelHeader()}<div class="settings-search-slot" bind:this={panels}><SettingsSearch /></div>{/snippet}
  {#snippet children({ value })}
    {#if value === "place"}<PlacePanel />
    {:else if value === "terrain"}<TerrainPanel />
    {:else if value === "features"}<FeaturesPanel />
    {:else if value === "water"}<WaterPanel />
    {:else if value === "aviation"}<AviationPanel />
    {:else if value === "labels"}<LabelsPanel />
    {:else}<MakePanel />{/if}
  {/snippet}
</Tabs>
