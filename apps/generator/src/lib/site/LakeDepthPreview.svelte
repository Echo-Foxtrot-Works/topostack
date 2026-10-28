<script lang="ts">
  import { basePath } from "$lib/site/paths";
  import type { LakePreview } from "$lib/site/lake-pages.server";
  const base = basePath();

  let { preview, name }: { preview: LakePreview; name: string } = $props();

  const metres = (value: number): string => value >= 10 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1).replace(/\.0$/, "");
  const modelledPercent = $derived(Math.round((1 - preview.surveyedShare) * 100));
</script>

<figure class="depth">
  <img src={`${base}${preview.src}`} width={preview.width} height={preview.height} decoding="async"
    alt={`Depth map of ${name}: shaded terrain around the lake, with the lake floor coloured from pale blue in the shallows to dark blue about ${metres(preview.maxDepthM)} m down, and depth contours every ${metres(preview.contourIntervalM)} m.`} />
  <figcaption>
    <span class="legend" aria-hidden="true">0 <span class="ramp"></span> {metres(preview.maxDepthM)} m</span>
    Deepest water about {metres(preview.maxDepthM)} m; contours every {metres(preview.contourIntervalM)} m, at true depth.
    {#if modelledPercent >= 2}Hatched water ({modelledPercent}%) has no survey coverage and uses the studio's modelled depths.{/if}
    Depths from {preview.surveys.join(" and ") || "the survey listed below"}; terrain from Mapzen.
  </figcaption>
</figure>

<style>
  .depth { margin: 24px 0 8px; }
  img { display: block; max-width: 100%; height: auto; margin-inline: auto; border: 1px solid var(--loidolt-border); border-radius: var(--loidolt-border-radius); }
  figcaption { font-size: 13px; line-height: 1.6; color: var(--loidolt-text-muted); margin-top: 10px; }
  .legend { display: inline-flex; align-items: center; gap: 6px; margin-right: 10px; font-size: 11px; white-space: nowrap; }
  /* The renderer's ramp (lake-preview/render.ts): pale, mid and deep blue on a square-root depth scale. */
  .ramp { display: inline-block; width: 96px; height: 8px; border-radius: 2px; background: linear-gradient(to right, rgb(205 232 240), rgb(88 160 200) 25%, rgb(22 62 105)); }
</style>
