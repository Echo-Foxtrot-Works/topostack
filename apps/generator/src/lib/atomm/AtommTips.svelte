<script lang="ts" module>
  /** Slide ids other controls can open the walkthrough on. */
  export type TipId = "place" | "layers" | "size" | "processing" | "lakes" | "export" | "assembly";
</script>

<script lang="ts">
  import { Info, X } from "@lucide/svelte";
  // Crops of what the studio itself draws, captured by scripts/dev/capture-atomm-tips.mjs.
  import assembly from "$lib/atomm/tips/assembly.webp";
  import exportView from "$lib/atomm/tips/export.webp";
  import lakes from "$lib/atomm/tips/lakes.webp";
  import layers from "$lib/atomm/tips/layers.webp";
  import place from "$lib/atomm/tips/place.webp";
  import processing from "$lib/atomm/tips/processing.webp";
  import size from "$lib/atomm/tips/size.webp";
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";

  let { onclose }: { onclose: () => void } = $props();

  // One step per slide, as the platform's Fabrication Tips walkthrough shows
  // them: a picture of the step, a title and a short description.
  const TIPS: Array<{ id: TipId; image: string; title: MessageKey; body: MessageKey[] }> = [
    { id: "place", image: place, title: "tips.placeTitle" as MessageKey, body: ["tips.placeBody" as MessageKey] },
    { id: "layers", image: layers, title: "tips.layersTitle" as MessageKey, body: ["tips.layersBody" as MessageKey] },
    { id: "size", image: size, title: "tips.sizeTitle" as MessageKey, body: ["tips.sizeBody" as MessageKey] },
    { id: "processing", image: processing, title: "tips.processingTitle" as MessageKey, body: ["tips.processingBody" as MessageKey] },
    { id: "lakes", image: lakes, title: "tips.lakesTitle" as MessageKey, body: ["tips.lakesBodySources" as MessageKey, "tips.lakesBodyControls" as MessageKey] },
    { id: "export", image: exportView, title: "tips.exportTitle" as MessageKey, body: ["tips.exportBody" as MessageKey] },
    { id: "assembly", image: assembly, title: "tips.assemblyTitle" as MessageKey, body: ["tips.assemblyBody" as MessageKey] },
  ];

  let dialog: HTMLDialogElement;
  let index = $state(0);
  const tip = $derived(TIPS[index]!);

  /** Opens the walkthrough on `id`, or on the first step. */
  export function open(id?: TipId): void {
    index = Math.max(0, TIPS.findIndex((entry) => entry.id === id));
    dialog.showModal();
  }
</script>

<dialog bind:this={dialog} class="dialog atomm-tips-dialog" aria-labelledby="atomm-tips-title" {onclose}>
  <div class="dialog-header">
    <h2 id="atomm-tips-title">{t("tips.dialogTitle")}</h2><Info size={20} class="icon" aria-hidden="true" /><span class="spacer" aria-hidden="true"></span>
    <span class="sr-only" aria-live="polite">{t("tips.stepAnnouncement", { step: index + 1, count: TIPS.length, title: t(tip.title) })}</span>
    <button type="button" class="btn-icon btn-icon-sm" aria-label={t("tips.close")} onclick={() => dialog.close()}><X size={16} aria-hidden="true" /></button>
  </div>
  <div class="atomm-tips-content">
  <div class="dialog-media" aria-hidden="true">
    <img src={tip.image} alt="" width="480" height="267" decoding="async" />
  </div>
  <div class="dialog-body">
    <div class="tip-slide"><h3>{t(tip.title)}</h3>{#each tip.body as paragraph}<p>{t(paragraph)}</p>{/each}</div>
  </div>
  </div>
  <div class="dialog-footer">
    <div class="dots" aria-hidden="true">{#each TIPS as entry, dot (entry.id)}<i aria-current={dot === index ? "true" : undefined}></i>{/each}</div>
    <span class="spacer" aria-hidden="true"></span>
    <button type="button" class="btn btn-secondary" disabled={index === 0} onclick={() => index -= 1}>{t("tips.back")}</button>
    {#if index < TIPS.length - 1}
      <button type="button" class="btn btn-primary" onclick={() => index += 1}>{t("tips.next")}</button>
    {:else}
      <button type="button" class="btn btn-primary" onclick={() => dialog.close()}>{t("tips.done")}</button>
    {/if}
  </div>
</dialog>
