<script lang="ts">
  import type { Snippet } from "svelte";
  import { Lightbulb, PanelLeftClose, PanelLeftOpen } from "@lucide/svelte";
  import AtommTips from "$lib/atomm/AtommTips.svelte";
  import { t } from "$lib/i18n/i18n.svelte";
  import "$lib/atomm/atomm-workbench.css";

  let { ready, blockedReason, preparing, exportPhase, exportTitle, exportDetail, leadHeader, lead, generate, parameterHeader, parameters, preview, dialogs }: {
    ready: boolean; blockedReason?: string; preparing: boolean;
    exportPhase: string; exportTitle: string; exportDetail: string;
    leadHeader: Snippet; lead: Snippet; generate: Snippet; parameterHeader: Snippet;
    parameters: Snippet<[(trigger: HTMLButtonElement) => void]>; preview: Snippet<[(trigger: HTMLButtonElement) => void]>; dialogs: Snippet;
  } = $props();
  let collapsed = $state(false);
  let connectionSlow = $state(false);
  $effect(() => {
    if (ready) { connectionSlow = false; return; }
    const timeout = window.setTimeout(() => connectionSlow = true, 8_000);
    return () => window.clearTimeout(timeout);
  });
  let tips: AtommTips;
  let tipsTrigger: HTMLButtonElement;
  let tipsReturnFocus: HTMLButtonElement | undefined;
  const openLakeDepthHelp = (trigger: HTMLButtonElement) => { tipsReturnFocus = trigger; tips.open("lakes"); };
</script>

<!-- Rendered skeleton from Atomm layout-3-generate: lead / canvas / parameters. -->
<div class="atomm-workbench gen-app" lang="en">
  <div class="gen-body">
    <aside class="gen-rail gen-rail-lead" aria-label={t("workbench.railTitle")} hidden={collapsed}>
      <div class="gen-rail-header"><span class="gen-rail-title">{t("workbench.railTitle")}</span><button type="button" class="btn-plate" aria-label={t("workbench.collapseRail")} aria-expanded="true" onclick={() => collapsed = true}><PanelLeftClose size={16} aria-hidden="true" /></button></div>
      <div class="gen-rail-scroll">
        <div class="gen-rail-content">{@render leadHeader()}{@render lead()}{@render generate()}</div>
      </div>
    </aside>
    <main class="gen-canvas" class:lead-collapsed={collapsed} aria-label={t("workbench.canvasLabel")}>
      {@render preview(openLakeDepthHelp)}
      <!-- Collapsed, the rail becomes a 40px pill that keeps its title. -->
      {#if collapsed}<button type="button" class="gen-rail-collapsed" aria-label={t("workbench.expandRail")} aria-expanded="false" onclick={() => collapsed = false}><span class="gen-rail-title">{t("workbench.railTitle")}</span><PanelLeftOpen size={16} aria-hidden="true" /></button>{/if}
      <button bind:this={tipsTrigger} type="button" class="btn-tips atomm-tips" onclick={(event) => { tipsReturnFocus = event.currentTarget; tips.open(); }}><Lightbulb size={20} aria-hidden="true" />{t("workbench.tipsButton")}</button>
    </main>
    <aside class="gen-rail gen-rail-params" aria-label={t("workbench.parametersLabel")}>
      <div class="gen-params-header">{@render parameterHeader()}</div>
      <div class="gen-rail-scroll"><div class="gen-params-content">{@render parameters(openLakeDepthHelp)}</div></div>
      <div class="gen-rail-footer atomm-export-footer">
        {#if blockedReason}<p class="atomm-export-note" role="status">{blockedReason}</p>{/if}
        {#if !ready}
          <p role="status">{connectionSlow ? t("workbench.connectionSlow") : t("workbench.connecting")}</p>
          {#if connectionSlow}<button type="button" class="btn btn-secondary" onclick={() => window.location.reload()}>{t("workbench.reloadConnection")}</button>{/if}
        {/if}
        <div data-atomm-export-button></div>
        {#if exportPhase !== "idle"}<p class="atomm-export-note" role="status" aria-live="polite" aria-busy={preparing}><strong>{exportTitle}</strong> {exportDetail}</p>{/if}
      </div>
    </aside>
  </div>
  <AtommTips bind:this={tips} onclose={() => (tipsReturnFocus?.isConnected ? tipsReturnFocus : tipsTrigger).focus()} />
  {@render dialogs()}
</div>
