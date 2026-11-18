<script lang="ts">
  import { Button } from "@loidolt/theme-svelte";
  let { title, detail, step, total = 3, compact = false, passive = false, onCancel, cancelLabel = "Cancel", class: extraClass = "" }: {
    title: string; detail: string; step?: number; total?: number; compact?: boolean; passive?: boolean;
    onCancel?: () => void; cancelLabel?: string; class?: string;
  } = $props();
</script>

<div class={`generation-overlay ${extraClass}`} class:preview-update-overlay={compact} role="status" aria-live="polite" style:pointer-events={passive ? "none" : undefined}>
  <div class="contour-loader" aria-hidden="true"><span></span><span></span><span></span></div>
  <strong>{title}</strong><small>{detail}</small>
  {#if step !== undefined}<span class="generation-step">Step {step} of {total}</span>{/if}
  {#if onCancel}<Button class="btn btn-secondary" style="pointer-events: auto" onclick={onCancel}>{cancelLabel}</Button>{/if}
</div>
