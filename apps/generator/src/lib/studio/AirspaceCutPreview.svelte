<script lang="ts">
  import SvgViewport from "$lib/studio/SvgViewport.svelte";
  import type { AirspaceLevelIR, GeometryIRV1 } from "@topostack/core";
  import AirspaceLevelArtwork from "$lib/studio/AirspaceLevelArtwork.svelte";
  import { t } from "$lib/i18n/i18n.svelte";
  let { geometry, level }: { geometry: GeometryIRV1; level: AirspaceLevelIR } = $props();
</script>

<div class="two-d-stage">
  <SvgViewport widthMm={geometry.widthMm} heightMm={geometry.heightMm} label="cut" svgLabel={t("aviation.cutPreviewLabel", { level: level.index + 1 })} controlsLabel={t("aviation.cutZoomControls")} resetLabel={t("aviation.resetCutView")}>
    <AirspaceLevelArtwork {level} lineStyle={geometry.lineStyle} />
  </SvgViewport>
  <div class="axis layer-elevation">{t("aviation.levelCaption", { altitude: level.altitudeFt, thickness: geometry.airspaceStack!.thicknessMm })}</div>
</div>
