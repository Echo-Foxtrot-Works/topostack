<script lang="ts">
  import { Minus, Plus, Scan } from "@lucide/svelte";
  import { t } from "$lib/i18n/i18n.svelte";
  let { value, min = 0.25, max = 6, onZoom, onFit }: { value: number; min?: number; max?: number; onZoom: (value: number) => void; onFit: () => void } = $props();
  const shortcuts = $derived([...new Set([value, ...[0.5, 1, 1.5, 2, 3, 4].filter(level => level >= min && level <= max)])].sort((a, b) => a - b));
</script>
<div class="atomm-zoom-cluster zoom-cluster" role="group" aria-label={t("workbench.zoomGroup")}>
  <button type="button" aria-label={t("workbench.zoomOut")} title={t("workbench.zoomOut")} disabled={value <= min} onclick={() => onZoom(Math.max(min, value / 1.2))}><Minus size={16} aria-hidden="true" /></button>
  <select aria-label={t("workbench.zoomLevel")} value={value} onchange={(event) => onZoom(Number(event.currentTarget.value))}>{#each shortcuts as level}<option value={level}>{t("workbench.zoomPercent", { percent: Math.round(level * 100) })}</option>{/each}</select>
  <button type="button" aria-label={t("workbench.zoomIn")} title={t("workbench.zoomIn")} disabled={value >= max} onclick={() => onZoom(Math.min(max, value * 1.2))}><Plus size={16} aria-hidden="true" /></button>
  <button type="button" aria-label={t("workbench.fitToCanvas")} title={t("workbench.fitToCanvas")} onclick={onFit}><Scan size={16} aria-hidden="true" /></button>
</div>
