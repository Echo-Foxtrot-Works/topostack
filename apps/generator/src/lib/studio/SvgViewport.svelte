<script lang="ts">
  import { getEmbedded } from "$lib/studio/embed-context";
  import { onDestroy, onMount, untrack, type Snippet } from "svelte";
  import { IconButton } from "@loidolt/theme-svelte";
  import AtommZoom from "$lib/atomm/AtommZoom.svelte";
  const isEmbedded = getEmbedded();
  import { Minus, Plus, RotateCcw } from "@lucide/svelte";

  let { widthMm, heightMm, label, svgLabel, controlsLabel, resetLabel, children, editable = false, topLeft = false, padding = 5, svg = $bindable(), onactivate, onkeydown, onviewchange }: {
    widthMm: number;
    heightMm: number;
    label: string;
    svgLabel: string;
    controlsLabel: string;
    resetLabel: string;
    children: Snippet;
    /** Editable surfaces keep clicks distinct from pan/pinch gestures. */
    editable?: boolean;
    topLeft?: boolean;
    padding?: number;
    svg?: SVGSVGElement;
    onactivate?: (event: MouseEvent) => void;
    onkeydown?: (event: KeyboardEvent) => void;
    onviewchange?: () => void;
  } = $props();

  // Use a compositor transform during gestures, then redraw the SVG sharply
  // once zoom settles. Both artwork modes share this camera and its controls.
  const MIN_ZOOM = 1;
  const MAX_ZOOM = 6;
  const ZOOM_STEP = 0.5;
  const ZOOM_SETTLE_MS = 180;
  let viewport: HTMLElement;
  let suppressClick = false;
  let panLayer: HTMLSpanElement;
  let canvas: HTMLSpanElement;
  let zoom = $state(MIN_ZOOM);
  let renderZoom = $state(MIN_ZOOM);
  let panX = $state(0);
  let panY = $state(0);
  // Pan remains a compositor translation, including after release. Only a
  // settled zoom changes the SVG camera and requires a fresh vector drawing.
  let dragging = $state(false);
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  let dragStart: { pointerId: number; x: number; y: number; panX: number; panY: number; unitsPerPixel: number } | undefined;
  const touches = new Map<number, { x: number; y: number }>();
  let pinch: { distance: number; x: number; y: number } | undefined;
  function touchPair() {
    const [a, b] = [...touches.values()];
    return a && b ? { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : undefined;
  }
  let dragFrame: number | undefined;
  let zoomCommitTimer: ReturnType<typeof setTimeout> | undefined;
  let canvasWidth = $state(0);
  let canvasHeight = $state(0);
  let artworkSize = "";
  const baseX = $derived((topLeft ? 0 : -widthMm / 2) - padding);
  const baseY = $derived((topLeft ? 0 : -heightMm / 2) - padding);
  const baseWidth = $derived(widthMm + padding * 2);
  const baseHeight = $derived(heightMm + padding * 2);
  const residualScale = $derived(zoom / renderZoom);
  const visibleWidth = $derived(baseWidth / zoom);
  const visibleHeight = $derived(baseHeight / zoom);
  const renderWidth = $derived(baseWidth / renderZoom);
  const renderHeight = $derived(baseHeight / renderZoom);
  const renderX = $derived(baseX + (baseWidth - renderWidth) / 2);
  const renderY = $derived(baseY + (baseHeight - renderHeight) / 2);
  const pixelsPerUnit = $derived(Math.min(canvasWidth / baseWidth, canvasHeight / baseHeight) * zoom);
  const previewX = $derived((-panX) * pixelsPerUnit);
  const previewY = $derived((-panY) * pixelsPerUnit);
  const viewBox = $derived(`${renderX} ${renderY} ${renderWidth} ${renderHeight}`);

  function clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function cancelZoomCommit(): void {
    if (zoomCommitTimer === undefined) return;
    clearTimeout(zoomCommitTimer);
    zoomCommitTimer = undefined;
  }

  function commitVectorZoom(): void {
    cancelZoomCommit();
    renderZoom = zoom;
    setPan(panX, panY, zoom);
  }

  function scheduleVectorZoom(): void {
    cancelZoomCommit();
    if (dragStart || pinch) return;
    zoomCommitTimer = setTimeout(commitVectorZoom, ZOOM_SETTLE_MS);
  }

  function clampedPan(x: number, y: number, scale = renderZoom): { x: number; y: number } {
    // Keep some artwork reachable, while allowing panning at the fitted zoom.
    const maximumX = (baseWidth + baseWidth / scale) / 2 - Math.min(baseWidth, baseWidth / scale) * 0.1;
    const maximumY = (baseHeight + baseHeight / scale) / 2 - Math.min(baseHeight, baseHeight / scale) * 0.1;
    return { x: clamp(x, -maximumX, maximumX), y: clamp(y, -maximumY, maximumY) };
  }

  function setPan(x: number, y: number, scale = renderZoom): void {
    const next = clampedPan(x, y, scale);
    panX = next.x;
    panY = next.y;
  }

  function setZoom(value: number): void {
    const next = clamp(value, MIN_ZOOM, MAX_ZOOM);
    if (next === zoom) return;
    zoom = next;
    setPan(panX, panY, zoom);
    scheduleVectorZoom();
  }

  function panUnitsPerPixel(): number | undefined {
    return Number.isFinite(pixelsPerUnit) && pixelsPerUnit > 0 ? 1 / pixelsPerUnit : undefined;
  }

  function cancelDragFrame(): void {
    if (dragFrame === undefined) return;
    cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
  }

  function resetDragLayer(): void {
    cancelDragFrame();
    dragOffsetX = 0;
    dragOffsetY = 0;
    if (panLayer) panLayer.style.transform = "translate3d(0, 0, 0)";
  }

  function scheduleDragFrame(): void {
    if (dragFrame !== undefined) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined;
      panLayer.style.transform = `translate3d(${dragOffsetX}px, ${dragOffsetY}px, 0)`;
    });
  }

  function resetView(): void {
    if (dragStart && viewport.hasPointerCapture(dragStart.pointerId)) viewport.releasePointerCapture(dragStart.pointerId);
    dragStart = undefined;
    touches.clear(); pinch = undefined;
    dragging = false;
    cancelZoomCommit();
    zoom = MIN_ZOOM;
    renderZoom = MIN_ZOOM;
    panX = 0;
    panY = 0;
    resetDragLayer();
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault();
    if (dragStart || pinch) return;
    const previous = zoom;
    const previousX = panX;
    const previousY = panY;
    // The canvas itself is transformed; measure its stable centered container.
    const bounds = viewport.getBoundingClientRect();
    const units = panUnitsPerPixel() ?? 0;
    const dx = (event.clientX - bounds.left - bounds.width / 2) * units;
    const dy = (event.clientY - bounds.top - bounds.height / 2) * units;
    setZoom(zoom * Math.exp(-event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1) * 0.0015));
    setPan(previousX + dx * (1 - previous / zoom), previousY + dy * (1 - previous / zoom), zoom);
  }

  function startPan(event: PointerEvent): void {
    if (!dragStart && !touches.size) suppressClick = false;
    if (editable) {
      // Native focus can scroll a clipped, zoomed canvas before its click lands.
      event.preventDefault();
      const target = event.target instanceof Element ? event.target.closest<HTMLElement | SVGElement>("[tabindex]") : null;
      (target ?? viewport).focus({ preventScroll: true });
    }
    if (event.pointerType === "touch") {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (!editable) viewport.setPointerCapture(event.pointerId);
      const pair = touchPair();
      if (pair) {
        suppressClick = true;
        viewport.setPointerCapture(event.pointerId);
        if (dragStart) {
          setPan(dragStart.panX - dragOffsetX * dragStart.unitsPerPixel, dragStart.panY - dragOffsetY * dragStart.unitsPerPixel, zoom);
          dragStart = undefined;
          resetDragLayer();
        }
        cancelZoomCommit();
        pinch = pair;
        dragging = true;
        return;
      }
    }
    if (event.button !== 0 || dragStart) return;
    cancelZoomCommit();
    const scale = panUnitsPerPixel();
    if (scale === undefined) return;
    if (!editable) viewport.setPointerCapture(event.pointerId);
    resetDragLayer();
    dragging = !editable;
    dragStart = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, panX, panY, unitsPerPixel: scale };
  }

  function movePan(event: PointerEvent): void {
    if (touches.has(event.pointerId)) {
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const pair = touchPair();
      if (pinch && pair && pinch.distance > 0) {
        event.preventDefault();
        const previous = zoom;
        const previousX = panX;
        const previousY = panY;
        const bounds = viewport.getBoundingClientRect();
        const units = panUnitsPerPixel() ?? 0;
        const dx = (pinch.x - bounds.left - bounds.width / 2) * units;
        const dy = (pinch.y - bounds.top - bounds.height / 2) * units;
        setZoom(zoom * pair.distance / pinch.distance);
        setPan(previousX - (pair.x - pinch.x) * units * previous / zoom + dx * (1 - previous / zoom), previousY - (pair.y - pinch.y) * units * previous / zoom + dy * (1 - previous / zoom), zoom);
        pinch = pair;
        return;
      }
    }
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    if (editable && !suppressClick) {
      if (Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 4) return;
      suppressClick = true;
      viewport.setPointerCapture(event.pointerId);
      dragging = true;
    }
    // Preview the same bounded camera that finishPan commits. Unbounded
    // screen offsets here would snap back to the pan limits on release.
    const next = clampedPan(
      dragStart.panX - (event.clientX - dragStart.x) * dragStart.unitsPerPixel,
      dragStart.panY - (event.clientY - dragStart.y) * dragStart.unitsPerPixel,
      zoom,
    );
    dragOffsetX = (dragStart.panX - next.x) / dragStart.unitsPerPixel;
    dragOffsetY = (dragStart.panY - next.y) / dragStart.unitsPerPixel;
    scheduleDragFrame();
  }

  function finishPan(event: PointerEvent): void {
    touches.delete(event.pointerId);
    if (pinch) {
      pinch = undefined;
      dragging = false;
      commitVectorZoom();
      // Continue with one-finger panning when the other finger is lifted.
      const remaining = touches.entries().next().value;
      const units = panUnitsPerPixel();
      if (remaining && units !== undefined) {
        const [pointerId, point] = remaining;
        dragStart = { pointerId, ...point, panX, panY, unitsPerPixel: units };
        dragging = true;
      }
    }
    if (!dragStart || dragStart.pointerId !== event.pointerId) return;
    if (editable && !suppressClick) {
      dragStart = undefined;
      dragging = false;
      scheduleVectorZoom();
      return;
    }
    const finalOffsetX = event.type === "pointerup" ? event.clientX - dragStart.x : dragOffsetX;
    const finalOffsetY = event.type === "pointerup" ? event.clientY - dragStart.y : dragOffsetY;
    const nextX = dragStart.panX - finalOffsetX * dragStart.unitsPerPixel;
    const nextY = dragStart.panY - finalOffsetY * dragStart.unitsPerPixel;
    dragStart = undefined;
    dragging = false;
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    resetDragLayer();
    setPan(nextX, nextY, zoom);
    commitVectorZoom();
  }

  function handleKeyDown(event: KeyboardEvent): void {
    onkeydown?.(event);
    if (event.defaultPrevented) return;
    if (event.key === "+" || event.key === "=") setZoom(zoom + ZOOM_STEP);
    else if (event.key === "-" || event.key === "_") setZoom(zoom - ZOOM_STEP);
    else if (event.key === "0" || event.key === "Home") resetView();
    else if (event.key === "ArrowLeft") { setPan(panX - visibleWidth * 0.1, panY, zoom); commitVectorZoom(); }
    else if (event.key === "ArrowRight") { setPan(panX + visibleWidth * 0.1, panY, zoom); commitVectorZoom(); }
    else if (event.key === "ArrowUp") { setPan(panX, panY - visibleHeight * 0.1, zoom); commitVectorZoom(); }
    else if (event.key === "ArrowDown") { setPan(panX, panY + visibleHeight * 0.1, zoom); commitVectorZoom(); }
    else return;
    event.preventDefault();
  }

  function filterClick(event: MouseEvent): void {
    if (editable && suppressClick && event.detail !== 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }

  $effect(() => {
    void zoom; void renderZoom; void panX; void panY; void canvasWidth; void canvasHeight;
    untrack(() => onviewchange?.());
  });

  $effect(() => {
    const nextSize = `${widthMm}:${heightMm}`;
    if (artworkSize && artworkSize !== nextSize) resetView();
    artworkSize = nextSize;
  });

  onMount(() => {
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      canvasWidth = entry.contentRect.width;
      canvasHeight = entry.contentRect.height;
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  });

  onDestroy(() => {
    cancelZoomCommit();
    cancelDragFrame();
  });

</script>

<!-- Editable surfaces defer capture until a drag is distinct from a click.
     Keep tracking a pointer that leaves the surface before that threshold. -->
<svelte:window
  onpointermove={event => { if (editable && dragStart && !viewport.contains(event.target as Node)) movePan(event); }}
  onpointerup={event => { if (editable) finishPan(event); }}
  onpointercancel={event => { if (editable) finishPan(event); }}
/>

<div class="svg-viewer">
  {#if isEmbedded()}<AtommZoom value={zoom} min={MIN_ZOOM} max={MAX_ZOOM} onZoom={setZoom} onFit={resetView} />{:else}
  <div class="svg-zoom-controls" aria-label={controlsLabel}>
    <IconButton label="Zoom out" size="sm" disabled={zoom <= MIN_ZOOM} onclick={() => setZoom(zoom - ZOOM_STEP)}><Minus size={15} /></IconButton>
    <span class="svg-zoom-value" aria-live="polite">{Math.round(zoom * 100)}%</span>
    <IconButton label="Zoom in" size="sm" disabled={zoom >= MAX_ZOOM} onclick={() => setZoom(zoom + ZOOM_STEP)}><Plus size={15} /></IconButton>
    <IconButton label={resetLabel} size="sm" disabled={zoom === MIN_ZOOM && panX === 0 && panY === 0} onclick={resetView}><RotateCcw size={14} /></IconButton>
  </div>
  {/if}
  <svelte:element this={editable ? "div" : "button"}
    type={editable ? undefined : "button"}
    role={editable ? "application" : undefined}
    tabindex={editable ? 0 : undefined}
    bind:this={viewport}
    class="svg-viewport" class:editable class:dragging class:detail-view={renderZoom >= 2}
    data-svg-viewport
    data-zoom={zoom.toFixed(2)}
    data-render-zoom={renderZoom.toFixed(2)}
    data-rendering={zoom === renderZoom ? "sharp" : "preview"}
    aria-label={`Interactive ${label} preview. Scroll or use plus and minus to zoom, drag or use arrow keys to pan, and press zero to reset.`}
    onclickcapture={filterClick}
    onclick={onactivate}
    onwheel={handleWheel}
    onpointerdown={startPan}
    onpointermove={movePan}
    onpointerup={finishPan}
    onpointercancel={finishPan}
    onlostpointercapture={finishPan}
    onkeydown={handleKeyDown}
  >
    <span bind:this={panLayer} class="svg-pan-layer">
    <span bind:this={canvas} class="svg-canvas" style:transform={`translate3d(${previewX}px, ${previewY}px, 0) scale(${residualScale})`}>
  <svg bind:this={svg} viewBox={viewBox} role="img" aria-label={svgLabel}>
    {@render children()}
  </svg>
    </span>
    </span>
  </svelte:element>
</div>

<style>
.svg-viewer { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; }
.svg-viewport.dragging { cursor: grabbing; }
.svg-viewport {
  /* Isolate the moving artwork from the surrounding page's paint surface.
     Keep this clip stationary: clipping the moving pan layer cuts off artwork. */
  contain: layout paint;
  transform: translateZ(0);
  width: 100%;
  height: 100%;
  min-height: 0;
  position: relative;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: initial;
}

/* At close zoom, SVG blur filters rasterize large offscreen surfaces as new
   tiles come into view. Keep decorative shadows for the overview; the vector
   linework remains unchanged and sharp at every zoom. Use settled zoom so this
   paint change happens with the vector redraw, never in the middle of a gesture. */
.svg-viewport.detail-view :global([data-preview-shadow]) {
  filter: none;
}

.svg-viewport:focus-visible {
  outline: 2px solid var(--loidolt-accent);
  outline-offset: -2px;
}

.svg-pan-layer {
  width: 100%;
  height: 100%;
  display: flex;
  transform: translate3d(0, 0, 0);
  will-change: transform;
  contain: layout;
}

.svg-canvas {
  width: var(--svg-canvas-width, min(90%, 1040px));
  height: var(--svg-canvas-height, min(100%, 760px));
  margin: auto;
  display: flex;
  transform-origin: center;
  will-change: transform;
  backface-visibility: hidden;
}

.svg-canvas svg {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: visible;
  pointer-events: none;
}

.svg-viewport.editable svg { pointer-events: auto; }

.svg-zoom-controls {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 3;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px;
  background: color-mix(in srgb, var(--loidolt-surface) 90%, transparent);
  border: var(--loidolt-border-width) solid var(--loidolt-border);
  box-shadow: var(--loidolt-shadow-popover);
}

.svg-zoom-value {
  min-width: 48px;
  height: 28px;
  color: var(--loidolt-text-muted);
  font: 9px var(--loidolt-font-utility);
  display: grid;
  place-items: center;
}

</style>
