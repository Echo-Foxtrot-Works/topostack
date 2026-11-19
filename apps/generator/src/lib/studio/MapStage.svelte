<script lang="ts">
  import { Button } from "@loidolt/theme-svelte";
  import type { GeoBounds } from "@topostack/core";
  import * as edits from "$lib/studio/project-edits";
  import { getStudio } from "$lib/studio/studio-context";

  /**
   * The map, wherever it is shown: choosing the terrain in map view, and
   * placing markers and paths in the custom data view. One copy, because the
   * handlers it needs (placing, dragging, resizing the selection) were worth
   * writing once.
   *
   * Without `onUnavailable` the stage says so itself and stays put. Map view
   * passes one because it has somewhere else to go; the custom data view has
   * nothing to fall back to, and its coordinates can still be typed.
   *
   * Only map view frames the terrain. A marker or a path needs no map area,
   * so the custom data view gets the same map without the selection box, and
   * panning there changes nothing about the project.
   */

  let { onUnavailable, lakeSelection, onLakeViewportChange, onLakeMapClick }: { lakeSelection?: { bounds?: GeoBounds; activeId?: string; lakes: { id: string; name: string; outline: [number, number][] }[] }; onLakeViewportChange?: (bounds: GeoBounds) => void; onLakeMapClick?: (lat: number, lon: number, lakeId?: string) => void; onUnavailable?: (reason?: "unsupported" | "load-failed") => void } = $props();
  const studio = getStudio();
  const MapCanvas = $derived(studio.MapCanvas);
  const { applyCustomDataEdit, cancelLineDraft, commitLineDraft, extendLineDraft, updateFabrication, updateLocation } = studio;
  let failed = $state(false);

  function unavailable(reason?: "unsupported" | "load-failed"): void {
    if (onUnavailable) onUnavailable(reason);
    else failed = true;
  }

  // With no map to click, placing and drawing must not stay armed. The map
  // reports itself unavailable while it is mounting, so this waits for an
  // effect to say so.
  $effect(() => { if (failed && (studio.placingMarker || studio.lineDraft)) { studio.placingMarker = false; cancelLineDraft(); } });
</script>

{#if failed}
  <div class="preview-loading" role="alert">{lakeSelection ? "The map is unavailable in this browser. Search and choose a lake from the list." : "The map is unavailable in this browser. Markers and paths can still be added by typing their coordinates."}</div>
{:else if MapCanvas}
  <MapCanvas
    {lakeSelection}
    {onLakeViewportChange}
    {onLakeMapClick}
    project={studio.project}
    bind:aspectLocked={studio.mapAspectLocked}
    placingMarker={studio.placingMarker}
    framing={studio.mode !== "custom"}
    hint={lakeSelection ? "Click inside a lake to select it · drag to explore" : studio.mode === "custom" ? "Dashed outline is your map area · drag to look around" : undefined}
    onPlaceMarker={(lat, lon) => {
      const patch = edits.addMarkerAt(studio.project, crypto.randomUUID(), { lat, lon });
      if (!patch) { studio.placingMarker = false; return; }
      applyCustomDataEdit(patch);
      if (!edits.canAddMarker({ markers: patch.markers })) studio.placingMarker = false;
    }}
    onMoveMarker={(id, lat, lon) => { const patch = edits.updateMarker(studio.project, id, { lat, lon }); applyCustomDataEdit(patch); return patch !== undefined; }}
    onStopPlacing={() => { studio.placingMarker = false; }}
    drawingLine={studio.lineDraft !== undefined}
    draftPoints={studio.lineDraft?.points ?? []}
    onDrawPoint={(lat, lon) => extendLineDraft({ lat, lon })}
    onFinishDraw={(closed) => commitLineDraft(closed)}
    onCancelDraw={cancelLineDraft}
    onSelectionResize={(widthMm, heightMm, bounds) => { void updateFabrication({ widthMm, heightMm, location: { ...studio.project.location, bounds } }); }}
    onUnavailable={unavailable}
    onLocationChange={(lat: number, lon: number, zoom: number, bounds: GeoBounds) => updateLocation({ lat, lon, zoom, bounds, label: `${lat.toFixed(4)}, ${lon.toFixed(4)}` })}
  />
{:else if studio.mapCanvas.failed}
  <!-- Map view falls back elsewhere on its own; the custom data view has nowhere to go. -->
  <div class="preview-loading preview-load-failed" role="alert">The map could not load<Button class="btn btn-secondary" onclick={() => studio.mapCanvas.load()}>Retry</Button></div>
{:else}
  <div class="preview-loading">Loading map…</div>
{/if}
