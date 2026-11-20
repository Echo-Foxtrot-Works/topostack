<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte";
  import { onMount } from "svelte";
  import { isFontLoaded, projectFonts, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";
  import type { PlacementPhase } from "$lib/studio/studio-context";
  import { ensureFonts } from "$lib/domain/fonts";
  import PlacementLayer from "./PlacementLayer.svelte";
  import StackTopView from "./StackTopView.svelte";
  import { placementContext, type PlacementSession } from "./placeables";

  /**
   * Placement mode over the preview. With `backdrop` "3d" the studio's own 3D
   * preview stays mounted underneath in its top-down state, so its meshes are
   * not rebuilt; "flat" draws the top-down composite here, over the view it
   * came from, which stays mounted so fading in and out never shows a gap.
   */
  let { backdrop, phase, geometry, project, cropShape, session, marginMm, hiddenPrefixes, onChange, onDone, onCancel }: {
    backdrop: "3d" | "flat";
    phase: PlacementPhase;
    geometry: GeometryIRV1;
    project: ProjectConfigV1;
    cropShape: ProjectConfigV1["cropShape"];
    session: PlacementSession;
    marginMm: number;
    hiddenPrefixes: readonly string[];
    onChange: (session: PlacementSession) => void;
    onDone: () => void;
    onCancel: () => void;
  } = $props();

  const context = $derived(placementContext(geometry));

  const fonts = $derived(projectFonts(project));
  const fontKey = $derived(fonts.join("|"));
  let loadedKey = $state<string>();
  let fontError = $state("");
  let retry = $state(0);
  const fontsReady = $derived(loadedKey === fontKey || fonts.every(isFontLoaded));
  $effect(() => {
    const key = fontKey;
    void retry;
    let active = true;
    fontError = "";
    void ensureFonts(fonts).then(() => {
      if (active) loadedKey = key;
    }, (error: unknown) => {
      if (active) fontError = error instanceof Error ? error.message : t("preview.engravingFontFailed");
    });
    return () => { active = false; };
  });

  // Rendered hidden, then shown on the next frame, so the fade-in always plays.
  let shown = $state(false);
  onMount(() => {
    const frame = requestAnimationFrame(() => { shown = true; });
    return () => cancelAnimationFrame(frame);
  });
</script>

<div class="placement-stage" class:placement-stage--flat={backdrop === "flat"} class:placement-stage--shown={shown && phase !== "closing"} data-placement-backdrop={backdrop} data-placement-phase={phase}>
  {#if backdrop === "flat"}<StackTopView {geometry} outputMode={project.outputMode} {cropShape} {marginMm} hiddenPrefixes={[""]} bare />{/if}
  {#if fontsReady}
  <PlacementLayer {geometry} {hiddenPrefixes} {project} {context} {session} widthMm={geometry.widthMm} heightMm={geometry.heightMm} {marginMm} interactive={phase === "editing"} {onChange} {onDone} {onCancel} />
  {:else}
    <div class="placement-toolbar" role="status">
      <span>{fontError || t("preview.loadingEngravingFont")}</span>
      {#if fontError}<button type="button" onclick={() => retry += 1}>{t("preview.retry")}</button>{/if}
      <button type="button" onclick={onCancel}>{t("preview.cancel")}</button>
    </div>
  {/if}
</div>
