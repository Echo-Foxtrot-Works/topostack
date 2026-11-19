<script lang="ts">
  import { t, type MessageKey } from "$lib/i18n/i18n.svelte";
  import { onMount, tick } from "svelte";
  import { Button } from "@loidolt/theme-svelte";
  import { Move, Trash2 } from "@lucide/svelte";
  import { displayLength, GRAPHIC_OPERATIONS, lengthUnit, type GeometryIRV1, type GraphicOperation, type Point2D, type ProjectConfigV1 } from "@topostack/core";
  import { pointsToPath } from "$lib/studio/svg-path";
  import { addGraphicToSession, availablePlaceables, draftProject, movePlaceable, placeableFor, removePlaceable, resizePlaceable, rotatePlaceable, setPlaceableOperation, type PlaceableId, type PlacementContext, type PlacementSession } from "./placeables";
  import PlacementArtwork from "./PlacementArtwork.svelte";
  import { placementViewBox } from "./viewport";

  let { geometry, hiddenPrefixes, project, context, session, widthMm, heightMm, marginMm, interactive = true, onChange, onDone, onCancel }: {
    geometry: GeometryIRV1;
    hiddenPrefixes: readonly string[];
    project: ProjectConfigV1;
    context: PlacementContext;
    session: PlacementSession;
    /** Size of the artwork the backdrop shows, which frames this layer too. */
    widthMm: number;
    heightMm: number;
    marginMm: number;
    /** False while Done's regeneration lands or the layer fades out: drafts stay drawn, input is ignored. */
    interactive?: boolean;
    onChange: (session: PlacementSession) => void;
    onDone: () => void;
    onCancel: () => void;
  } = $props();

  const NUDGE_MM = 1;
  const NUDGE_LARGE_MM = 10;
  /** On-screen radius of the resize grip, in pixels. */
  const GRIP_PX = 7;
  /** How far the rotation grip stands off the item's top edge, in pixels. */
  const ROTATE_STANDOFF_PX = 22;
  const ROTATE_STEP_DEG = 15;
  const ROTATE_FINE_DEG = 1;

  let svg: SVGSVGElement;
  let drag: { id: PlaceableId; pointerId: number; x: number; y: number; unitsPerPixel: number; start: Point2D } | undefined;
  let resizing: { id: PlaceableId; pointerId: number; center: Point2D; startDistance: number; startSize: number } | undefined;
  let rotating: { id: PlaceableId; pointerId: number; center: Point2D; startAngle: number; startRotation: number } | undefined;
  let dragging = $state<PlaceableId | undefined>();
  // Millimeters per pixel, kept current so the grip stays the same size on screen.
  let pixel = $state(0.5);

  const draft = $derived(draftProject(project, session));
  const items = $derived(availablePlaceables(draft).map((placeable) => {
    const ring = placeable.outline(draft, context);
    const center = placeable.center(draft, context);
    return { placeable, grip: placeable.resize ? gripPoint(ring) : undefined, rotateGrip: placeable.rotate ? rotateGripPoint(ring, center) : undefined, outline: pointsToPath(ring) };
  }));
  const viewBox = $derived(placementViewBox(widthMm, heightMm, marginMm));
  // A graphic removed in this session, or from the library, leaves nothing selected.
  const selected = $derived.by(() => {
    const placeable = placeableFor(session.selected);
    return placeable.available(draft) ? placeable : undefined;
  });
  const selectedLabel = $derived(selected ? selected.name?.(draft) ?? selected.label : undefined);
  const sizeReadout = $derived(selected?.resize ? t("preview.placementSize", { label: selected.resize.label, value: Number(displayLength(selected.resize.value(draft), draft.units).toFixed(draft.units === "imperial" ? 2 : 1)), unit: lengthUnit(draft.units) }) : undefined);
  const rotationReadout = $derived(selected?.rotate ? t("preview.placementRotation", { value: Number(selected.rotate.value(draft).toFixed(1)) }) : undefined);
  // "Placing {item}" with the item in bold: the translation sets where the name sits.
  const placingParts = $derived(t("preview.placing", { item: "\u0000" }).split("\u0000"));
  const handleLabel = (placeable: (typeof items)[number]["placeable"]) => [
    t("preview.placementHandle", { item: placeable.name?.(draft) ?? placeable.label }),
    placeable.resize ? t("preview.placementHandleResize") : "",
    placeable.rotate ? t("preview.placementHandleRotate") : "",
    placeable.remove ? t("preview.placementHandleRemove") : "",
  ].filter(Boolean).join(" ");
  const placementHint = $derived(selected ? [
    t("preview.placementHintMove"),
    selected.resize ? t("preview.placementHintResize") : "",
    selected.rotate ? t("preview.placementHintRotate") : "",
    t("preview.placementHintNudge"),
    selected.resize ? t("preview.placementHintSize") : "",
    t("preview.placementHintTab"),
  ].filter(Boolean).join(" · ") : "");
  const graphics = $derived(draft.customGraphics ?? []);
  const selectedOperation = $derived(selected?.operation?.value(draft));

  /** The outline point furthest toward the lower right: a box corner, or 45° round a circle. */
  function gripPoint(ring: Point2D[]): Point2D {
    return ring.reduce((best, point) => (point.x + point.y > best.x + best.y ? point : best), ring[0] ?? { x: 0, y: 0 });
  }

  /** Beyond the middle of the outline's first edge, which is the top of a graphic's box before it turns. */
  function rotateGripPoint(ring: Point2D[], center: Point2D): Point2D | undefined {
    const [first, second] = ring;
    if (!first || !second) return undefined;
    const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    const length = Math.hypot(mid.x - center.x, mid.y - center.y) || 1;
    const standoff = ROTATE_STANDOFF_PX * pixel;
    return { x: mid.x + (mid.x - center.x) / length * standoff, y: mid.y + (mid.y - center.y) / length * standoff };
  }

  /** Artwork millimeters per screen pixel, for a viewBox fitted with xMidYMid meet. */
  function unitsPerPixel(): number | undefined {
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    return Math.max(viewBox.width / rect.width, viewBox.height / rect.height);
  }

  /** A pointer position in artwork millimeters, for the meet-fitted viewBox. */
  function toArtwork(event: PointerEvent): Point2D | undefined {
    const rect = svg.getBoundingClientRect();
    const scale = unitsPerPixel();
    if (!scale) return undefined;
    const offsetX = (rect.width - viewBox.width / scale) / 2;
    const offsetY = (rect.height - viewBox.height / scale) / 2;
    return { x: viewBox.x + (event.clientX - rect.left - offsetX) * scale, y: viewBox.y + (event.clientY - rect.top - offsetY) * scale };
  }

  function resize(id: PlaceableId, sizeMm: number): void {
    if (!interactive) return;
    onChange(resizePlaceable(project, session, id, sizeMm, context));
  }

  function rotate(id: PlaceableId, degrees: number): void {
    if (!interactive) return;
    onChange(rotatePlaceable(project, session, id, degrees));
  }

  const angleDeg = (point: Point2D, center: Point2D) => Math.atan2(point.y - center.y, point.x - center.x) * 180 / Math.PI;

  function startRotate(event: PointerEvent, id: PlaceableId): void {
    const control = placeableFor(id).rotate;
    const point = toArtwork(event);
    if (event.button !== 0 || drag || resizing || rotating || !interactive || !control || !point) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const center = placeableFor(id).center(draft, context);
    rotating = { id, pointerId: event.pointerId, center, startAngle: angleDeg(point, center), startRotation: control.value(draft) };
    dragging = id;
    select(id);
  }

  function moveRotate(event: PointerEvent): void {
    if (!rotating || rotating.pointerId !== event.pointerId) return;
    const point = toArtwork(event);
    if (!point) return;
    const turned = rotating.startRotation + angleDeg(point, rotating.center) - rotating.startAngle;
    // Shift snaps to the keyboard step, so square angles are easy to hit.
    rotate(rotating.id, event.shiftKey ? Math.round(turned / ROTATE_STEP_DEG) * ROTATE_STEP_DEG : turned);
  }

  function endRotate(event: PointerEvent): void {
    if (!rotating || rotating.pointerId !== event.pointerId) return;
    rotating = undefined;
    dragging = undefined;
  }

  function remove(id: PlaceableId): void {
    if (!interactive || !placeableFor(id).remove) return;
    const next = removePlaceable(project, session, id);
    onChange(next);
    void tick().then(() => svg.querySelector<SVGElement>(`[data-placeable="${next.selected}"]`)?.focus());
  }

  function setOperation(id: PlaceableId, operation: GraphicOperation): void {
    if (!interactive) return;
    onChange(setPlaceableOperation(project, session, id, operation));
  }

  function addGraphic(graphicId: string): void {
    if (!interactive || !graphicId) return;
    const next = addGraphicToSession(project, session, graphicId, crypto.randomUUID());
    if (!next) return;
    onChange(next);
    void tick().then(() => svg.querySelector<SVGElement>(`[data-placeable="${next.selected}"]`)?.focus());
  }

  function startResize(event: PointerEvent, id: PlaceableId): void {
    const size = placeableFor(id).resize;
    const point = toArtwork(event);
    if (event.button !== 0 || drag || resizing || !interactive || !size || !point) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    const center = placeableFor(id).center(draft, context);
    resizing = { id, pointerId: event.pointerId, center, startDistance: Math.max(Math.hypot(point.x - center.x, point.y - center.y), 0.1), startSize: size.value(draft) };
    dragging = id;
    select(id);
  }

  function moveResize(event: PointerEvent): void {
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    const point = toArtwork(event);
    if (!point) return;
    const distance = Math.hypot(point.x - resizing.center.x, point.y - resizing.center.y);
    resize(resizing.id, resizing.startSize * distance / resizing.startDistance);
  }

  function endResize(event: PointerEvent): void {
    if (!resizing || resizing.pointerId !== event.pointerId) return;
    resizing = undefined;
    dragging = undefined;
  }

  function move(id: PlaceableId, center: Point2D): void {
    if (!interactive) return;
    onChange(movePlaceable(project, session, id, center, context));
  }

  function select(id: PlaceableId): void {
    if (!interactive) return;
    if (session.selected !== id) onChange({ ...session, selected: id });
  }

  function startDrag(event: PointerEvent, id: PlaceableId): void {
    if (event.button !== 0 || drag || !interactive) return;
    const scale = unitsPerPixel();
    if (!scale) return;
    event.preventDefault();
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    (event.currentTarget as SVGElement).focus();
    drag = { id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, unitsPerPixel: scale, start: placeableFor(id).center(draft, context) };
    dragging = id;
    select(id);
  }

  function moveDrag(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    move(drag.id, { x: drag.start.x + (event.clientX - drag.x) * drag.unitsPerPixel, y: drag.start.y + (event.clientY - drag.y) * drag.unitsPerPixel });
  }

  function endDrag(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = undefined;
    dragging = undefined;
  }

  function handleItemKey(event: KeyboardEvent, id: PlaceableId): void {
    const placeable = placeableFor(id);
    const size = placeable.resize;
    if ((event.key === "Delete" || event.key === "Backspace") && placeable.remove) {
      event.preventDefault();
      event.stopPropagation();
      remove(id);
      return;
    }
    // [ and ] turn by the coarse step; with Shift ({ and }) by a single degree.
    const turn = event.key === "]" ? ROTATE_STEP_DEG : event.key === "[" ? -ROTATE_STEP_DEG : event.key === "}" ? ROTATE_FINE_DEG : event.key === "{" ? -ROTATE_FINE_DEG : 0;
    if (turn && placeable.rotate) {
      event.preventDefault();
      event.stopPropagation();
      rotate(id, placeable.rotate.value(draft) + turn);
      return;
    }
    const grow = event.key === "+" || event.key === "=" ? 1 : event.key === "-" || event.key === "_" ? -1 : 0;
    if (grow && size) {
      event.preventDefault();
      event.stopPropagation();
      resize(id, size.value(draft) + grow * size.step * (event.shiftKey ? 5 : 1));
      return;
    }
    const step = event.shiftKey ? NUDGE_LARGE_MM : NUDGE_MM;
    const [dx, dy] = event.key === "ArrowLeft" ? [-step, 0] : event.key === "ArrowRight" ? [step, 0] : event.key === "ArrowUp" ? [0, -step] : event.key === "ArrowDown" ? [0, step] : [0, 0];
    if (!dx && !dy) return;
    event.preventDefault();
    event.stopPropagation();
    const from = placeable.center(draft, context);
    move(id, { x: from.x + dx, y: from.y + dy });
  }

  function handleKey(event: KeyboardEvent): void {
    if (!interactive) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
    else if (event.key === "Enter" && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); event.stopPropagation(); onDone(); }
  }

  onMount(() => {
    // Start with the chosen item focused, so the arrow keys move it right away.
    void tick().then(() => svg.querySelector<SVGElement>(`[data-placeable="${session.selected}"]`)?.focus());
    const observer = new ResizeObserver(() => { pixel = unitsPerPixel() ?? pixel; });
    observer.observe(svg);
    return () => observer.disconnect();
  });
</script>

<!-- Escape and Enter here are shortcuts for the toolbar's Cancel and Done buttons. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="placement-layer" class:placement-layer--inert={!interactive} inert={!interactive} onkeydown={handleKey}>
  <svg bind:this={svg} viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`} data-placement-layer>
    <PlacementArtwork {geometry} project={draft} {context} {hiddenPrefixes} />
    {#each items as { placeable, grip, rotateGrip, outline } (placeable.id)}
      <g class="placement-item" class:placement-item--selected={session.selected === placeable.id} class:placement-item--dragging={dragging === placeable.id} data-placement-item={placeable.id}>
        <path
          class="placement-handle" d={`${outline} Z`}
          data-placeable={placeable.id}
          role="button" tabindex="0"
          aria-label={handleLabel(placeable)}
          aria-pressed={session.selected === placeable.id}
          onfocus={() => select(placeable.id)}
          onpointerdown={(event) => startDrag(event, placeable.id)} onpointermove={moveDrag} onpointerup={endDrag} onpointercancel={endDrag} onlostpointercapture={endDrag}
          onkeydown={(event) => handleItemKey(event, placeable.id)}
        />
        {#if grip && session.selected === placeable.id}
          <!-- Pointer-only: the focused item resizes with plus and minus. -->
          <circle
            class="placement-grip" cx={grip.x} cy={grip.y} r={GRIP_PX * pixel}
            data-placement-grip={placeable.id} aria-hidden="true"
            onpointerdown={(event) => startResize(event, placeable.id)} onpointermove={moveResize} onpointerup={endResize} onpointercancel={endResize} onlostpointercapture={endResize}
          />
        {/if}
        {#if rotateGrip && session.selected === placeable.id}
          {@const center = placeable.center(draft, context)}
          <!-- Pointer-only, like the resize grip: the focused item turns with the bracket keys. -->
          <line class="placement-rotate-stem" x1={center.x} y1={center.y} x2={rotateGrip.x} y2={rotateGrip.y} aria-hidden="true" />
          <circle
            class="placement-grip placement-grip--rotate" cx={rotateGrip.x} cy={rotateGrip.y} r={GRIP_PX * pixel}
            data-placement-rotate={placeable.id} aria-hidden="true"
            onpointerdown={(event) => startRotate(event, placeable.id)} onpointermove={moveRotate} onpointerup={endRotate} onpointercancel={endRotate} onlostpointercapture={endRotate}
          />
        {/if}
      </g>
    {/each}
  </svg>
  <div class="placement-toolbar" class:placement-toolbar--graphics={graphics.length > 0} role="toolbar" aria-label={t("preview.placementToolbar")} inert={!interactive}>
    <span class="placement-toolbar__icon" aria-hidden="true"><Move size={16} /></span>
    <span class="placement-toolbar__text">
      {#if selected}
        <span class="placement-toolbar__status" aria-live="polite">{placingParts[0]}<b>{selectedLabel}</b>{placingParts[1]}{#if sizeReadout}<span class="placement-toolbar__size">{sizeReadout}</span>{/if}{#if rotationReadout}<span class="placement-toolbar__size">{rotationReadout}</span>{/if}</span>
        <span class="placement-toolbar__hint">{placementHint}</span>
      {:else}
        <span class="placement-toolbar__status" aria-live="polite">{t("preview.placementNothingSelected")}</span>
        <span class="placement-toolbar__hint">{t("preview.placementNothingSelectedHint")}</span>
      {/if}
    </span>
    <Button size="sm" onclick={onCancel}>{t("preview.cancel")}</Button>
    <Button variant="primary" size="sm" onclick={onDone}>{t("preview.done")}</Button>
    {#if graphics.length}
      <div class="placement-toolbar__graphics">
        <select class="placement-add-graphic" aria-label={t("preview.addGraphicToPiece")} value="" onchange={(event) => { const select = event.currentTarget; addGraphic(select.value); select.value = ""; }}>
          <option value="" disabled>{t("preview.addGraphic")}</option>
          {#each graphics as graphic (graphic.id)}<option value={graphic.id}>{graphic.name}</option>{/each}
        </select>
        {#if selected?.operation && selectedOperation}
          {@const id = selected.id}
          <span class="placement-operation" role="radiogroup" aria-label={t("preview.graphicOperation")}>
            {#each GRAPHIC_OPERATIONS as operation (operation)}
              <button type="button" role="radio" aria-checked={selectedOperation === operation} data-state={selectedOperation === operation ? "on" : "off"} onclick={() => setOperation(id, operation)}>{t(`preview.graphicOperation.${operation}` as MessageKey)}</button>
            {/each}
          </span>
          {#if selectedOperation === "cut"}<span class="placement-toolbar__hint">{t("preview.graphicCutHint")}</span>{/if}
        {/if}
        {#if selected?.remove}
          {@const id = selected.id}
          <button type="button" class="placement-remove" aria-label={t("preview.removeFromPiece", { item: selectedLabel ?? "" })} title={t("preview.removeFromPieceTitle")} onclick={() => remove(id)}><Trash2 size={14} /></button>
        {/if}
      </div>
    {/if}
  </div>
</div>
