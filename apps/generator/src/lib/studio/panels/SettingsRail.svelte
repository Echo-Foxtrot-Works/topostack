<script lang="ts">
  import { MapPin, Mountain, Plane, Route, Type, Waves, Wrench, X } from "@lucide/svelte";
  import { Tabs, type TabItem } from "@loidolt/theme-svelte";
  import { PANEL_IDS, PANEL_LABELS, type PanelId } from "$lib/studio/preview-summary";
  import AviationPanel from "$lib/studio/panels/AviationPanel.svelte";
  import FeaturesPanel from "$lib/studio/panels/FeaturesPanel.svelte";
  import LabelsPanel from "$lib/studio/panels/LabelsPanel.svelte";
  import MakePanel from "$lib/studio/panels/MakePanel.svelte";
  import PlacePanel from "$lib/studio/panels/PlacePanel.svelte";
  import SettingsSearch from "$lib/studio/panels/SettingsSearch.svelte";
  import TerrainPanel from "$lib/studio/panels/TerrainPanel.svelte";
  import WaterPanel from "$lib/studio/panels/WaterPanel.svelte";
  import type { SettingsSheet } from "$lib/studio/panel-state.svelte";
  import { phoneLayout, railOrientation } from "$lib/studio/rail-orientation.svelte";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * The standalone studio's settings: a rail of panels, one shown at a time,
   * with the settings search pinned above them. Every panel stays mounted, so
   * hidden controls keep their state and the search can find them. Where the
   * workspace stacks, the rail becomes a row of tabs above the panel.
   *
   * On a phone the tabs sit at the foot of the screen and the active panel
   * opens over the lower part of the preview as a sheet: tapping a tab opens
   * it, tapping the open tab again closes it, and its handle steps it between
   * half and nearly full height. The sheet is not modal, so the preview above
   * it stays usable.
   */
  const studio = getStudio();
  const orientation = railOrientation();
  const phone = phoneLayout();
  let panels = $state<HTMLElement | null>(null);
  let root = $state<HTMLElement | null>(null);
  const SIZES: SettingsSheet[] = ["closed", "half", "full"];

  const activeTab = () => root?.querySelector<HTMLElement>('.ldt-tabs__list [role="tab"][aria-selected="true"]') ?? null;

  function resize(next: SettingsSheet): void {
    // Keep focus on a control the user can still see.
    if (next === "closed" && root?.querySelector(".ldt-tabs__panels")?.contains(document.activeElement)) activeTab()?.focus();
    studio.settingsSheet = next;
  }

  function step(by: 1 | -1): void {
    resize(SIZES[Math.min(SIZES.length - 1, Math.max(0, SIZES.indexOf(studio.settingsSheet) + by))] ?? "half");
  }

  // A tab press opens the sheet; pressing the tab that is already showing closes it.
  // Whether it was already selected is read before the tabs act on the press.
  let pressedSelected = false;
  function notePress(event: Event): void {
    pressedSelected = (event.target as Element).closest('[role="tab"]')?.getAttribute("aria-selected") === "true";
  }
  function tabActivated(event: MouseEvent): void {
    if (!phone.current || !(event.target as Element).closest('.ldt-tabs__list [role="tab"]')) return;
    if (pressedSelected && studio.settingsSheet !== "closed") resize("closed");
    else if (studio.settingsSheet === "closed") studio.settingsSheet = "half";
    pressedSelected = false;
  }

  function notePressKey(event: KeyboardEvent): void {
    if (event.key === "Enter" || event.key === " ") notePress(event);
  }

  // Bubbling, so a control inside the panel (the search's results) handles Escape first.
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape" || event.defaultPrevented || !phone.current || studio.settingsSheet === "closed") return;
    if (!(event.target as Element).closest(".ldt-tabs__panels")) return;
    event.preventDefault();
    resize("closed");
  }

  // The handle: a tap steps between half and full; a drag of more than a few pixels steps up or down.
  let drag: number | undefined;
  let dragged = false;
  function handleDown(event: PointerEvent): void {
    drag = event.clientY;
    dragged = false;
    (event.currentTarget as Element).setPointerCapture?.(event.pointerId);
  }
  function handleUp(event: PointerEvent): void {
    if (drag === undefined) return;
    const distance = event.clientY - drag;
    drag = undefined;
    if (Math.abs(distance) < 24) return;
    dragged = true;
    step(distance < 0 ? 1 : -1);
  }
  function handleClick(): void {
    if (dragged) { dragged = false; return; }
    resize(studio.settingsSheet === "full" ? "half" : "full");
  }

  // Placing a label or graphic works on the preview, so the sheet steps aside for it.
  $effect(() => {
    if (phone.current && studio.placement && studio.settingsSheet !== "closed") studio.settingsSheet = "closed";
  });

  // The active tab says whether its panel is showing, which only the phone sheet can change.
  $effect(() => {
    const expanded = phone.current ? String(studio.settingsSheet !== "closed") : null;
    void studio.activePanel;
    for (const tab of root?.querySelectorAll<HTMLElement>('.ldt-tabs__list [role="tab"]') ?? []) {
      if (expanded !== null && tab.getAttribute("aria-selected") === "true") tab.setAttribute("aria-expanded", expanded);
      else tab.removeAttribute("aria-expanded");
    }
  });
</script>

{#snippet place()}<MapPin strokeWidth={1.8} />{/snippet}
{#snippet terrain()}<Mountain strokeWidth={1.8} />{/snippet}
{#snippet features()}<Route strokeWidth={1.8} />{/snippet}
{#snippet water()}<Waves strokeWidth={1.8} />{/snippet}
{#snippet aviation()}<Plane strokeWidth={1.8} />{/snippet}
{#snippet labels()}<Type strokeWidth={1.8} />{/snippet}
{#snippet make()}<Wrench strokeWidth={1.8} />{/snippet}

<Tabs
  bind:ref={root}
  class="settings-rail"
  data-sheet={phone.current ? studio.settingsSheet : undefined}
  onpointerdowncapture={notePress}
  onkeydowncapture={notePressKey}
  onkeydown={onKeydown}
  onclick={tabActivated}
  variant="rail"
  orientation={orientation.current}
  label="Settings panels"
  panelsClass="settings-panels"
  bind:value={studio.activePanel}
  onValueChange={() => { panels?.closest(".ldt-tabs__panels")?.scrollTo?.({ top: 0 }); if (phone.current && studio.settingsSheet === "closed") studio.settingsSheet = "half"; }}
  tabs={PANEL_IDS.map((panel): TabItem<PanelId> => ({ value: panel, label: PANEL_LABELS[panel], icon: { place, terrain, features, water, aviation, labels, make }[panel], description: studio.panelSummary(panel) }))}
>
  {#snippet panelHeader()}
    <div class="settings-sheet-bar">
      <button type="button" class="settings-sheet-handle" aria-label={studio.settingsSheet === "full" ? "Shrink settings" : "Expand settings"} onpointerdown={handleDown} onpointerup={handleUp} onpointercancel={() => { drag = undefined; }} onclick={handleClick}><span aria-hidden="true"></span></button>
      <button type="button" class="settings-sheet-close" aria-label="Hide settings" title="Hide settings" onclick={() => resize("closed")}><X size={18} aria-hidden="true" /></button>
    </div>
    <div class="settings-search-slot" bind:this={panels}><SettingsSearch /></div>
  {/snippet}
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
