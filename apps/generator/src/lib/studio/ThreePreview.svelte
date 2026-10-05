<script module lang="ts">
  // Persist the user's orbit across preview-mode switches: the component is
  // destroyed when leaving 3D mode, so the camera pose lives at module level.
  // The fit signature and fitted view travel with the pose, so a remounted
  // preview of the same model keeps the orbit instead of refitting it.
  let savedCamera: { position: [number, number, number]; target: [number, number, number]; fitSignature?: string; fitDistance: number; fitTarget: [number, number, number] } | undefined;
</script>

<script lang="ts">
  import { onMount, untrack, getContext } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
  import { placementFrustum, placementViewBox } from "$lib/studio/placement/viewport";
  import { hiddenByPrefix } from "$lib/studio/placement/placeables";
  import { aviationStroke, labelLineSegments, type GeometryIRV1, type Point2D, type Polygon2D, type TextStyleV1 } from "@topostack/core";

  /**
   * `placement` turns the preview into the backdrop for placement mode: the
   * stack collapses and the camera eases to a top-down orthographic view fitted
   * like the placement layer's viewBox, orbiting is off, and generated markings
   * matching `hiddenPrefixes` are left out while their drafts are drawn above.
   */
  let { geometry, exploded, placement, onUnavailable, rememberCamera = true }: {
    geometry: Pick<GeometryIRV1, "widthMm" | "heightMm" | "layers" | "waterSurfaces" | "lineStyle" | "waterInserts" | "waterInsertMaterial">;
    /** Isolated representative previews must not replace the project camera. */
    rememberCamera?: boolean;
    exploded: number;
    /** `toolbarRows` is how many rows the placement toolbar has; the stage reserves more space above the drawing for two. */
    placement?: { hiddenPrefixes: readonly string[]; marginMm: number; hideMarkings?: boolean; toolbarRows?: number };
    onUnavailable?: () => void;
  } = $props();
  import AtommZoom from "$lib/atomm/AtommZoom.svelte";
  import { MARKING_COLORS, markingStyleKey, type MarkingStyleKey } from "$lib/studio/marking-style";
  import { PreviewMotion } from "$lib/studio/preview-motion";
  import { sharedPieceEdges } from "$lib/studio/seam-lines";
  const isEmbedded = getContext<() => boolean>("atomm-embedded") ?? (() => false);
  let zoom = $state(1);
  let fitDistance = 320;
  let fitTarget = new THREE.Vector3();
  function setZoom(value: number) {
    if (!runtime) return;
    const direction = runtime.camera.position.clone().sub(runtime.controls.target).normalize();
    runtime.camera.position.copy(runtime.controls.target).addScaledVector(direction, fitDistance / value);
    runtime.controls.update(); runtime.requestRender();
  }
  export function fitView() {
    if (!runtime) return;
    runtime.controls.target.copy(fitTarget);
    setZoom(1);
  }
  let container: HTMLButtonElement;
  let runtime: Runtime | undefined;

  interface Runtime {
    renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    /** Top-down camera for placement mode; used once the ease to overhead finishes. */
    topCamera: THREE.OrthographicCamera; topDown: boolean;
    rig: THREE.Group; content: THREE.Group; resizeObserver: ResizeObserver; frame: number;
    environmentTarget: THREE.WebGLRenderTarget; texture: THREE.CanvasTexture; fitSignature?: string;
    keyLight: THREE.DirectionalLight; detachContextHandlers: () => void; requestRender: () => void;
    /** Materials and textures created by the last rebuild, including ones no object ended up using. */
    sceneResources: Array<{ dispose: () => void }>;
    /** Extruded layer bodies surviving across rebuilds, by layer id. */
    layerMeshes: Map<string, CachedLayer>;
  }

  interface CachedLayer {
    /** Signature of everything the extrusion depends on; a mismatch rebuilds it. */
    key: string;
    meshes: THREE.Mesh[];
    /** Cut lines between the pieces of a split layer, as segment pairs. */
    seams: number[];
    /** The top-face material, which knockout markings also draw with. */
    face: THREE.MeshStandardMaterial;
    /** Materials and textures only this layer's meshes reference. */
    resources: Array<{ dispose: () => void }>;
  }

  /**
   * Signature of a layer's extruded body. The worker answers with a structured
   * clone, so every result is a fresh object graph and reference identity can
   * never match: a text-size, line-width or kerf edit re-triangulated all 24
   * layers although their cut polygons had not moved. Hashing coordinates is
   * linear and far cheaper than `ExtrudeGeometry`, so the body is rebuilt only
   * when its shape, thickness or stack position actually changed.
   */
  function layerKey(layer: GeometryIRV1["layers"][number]): string {
    let hash = 0x811c9dc5;
    let vertices = 0;
    const mix = (value: number) => { hash = Math.imul(hash ^ (value | 0), 0x01000193) >>> 0; };
    const mixRing = (ring: Point2D[]) => {
      mix(ring.length);
      vertices += ring.length;
      // 8192 units per mm: finer than any edit a preview can show, and integer
      // mixing avoids a float-to-string per coordinate.
      for (const point of ring) { mix(Math.round(point.x * 8192)); mix(Math.round(point.y * 8192)); }
    };
    for (const polygon of layer.polygons) {
      mix(polygon.holes.length);
      mixRing(polygon.outer);
      for (const hole of polygon.holes) mixRing(hole);
    }
    return `${layer.index}:${layer.materialThicknessMm}:${layer.polygons.length}:${vertices}:${hash}`;
  }

  interface StackedObject { layerIndex: number; baseZ: number }

  // Faces are pushed one depth unit back so coincident engrave/score lines
  // resolve in front of them regardless of viewing angle.
  const SURFACE_DEPTH_BIAS = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;

  // Markings ride above the face they annotate by a fraction of the stock
  // thickness, so thin material does not collapse them into the surface.
  function markingLift(materialThicknessMm: number): number { return Math.max(materialThicknessMm * 0.04, 0.05); }

  function shapeFromPolygon(polygon: Polygon2D): THREE.Shape {
    const shape = new THREE.Shape();
    polygon.outer.forEach((point, index) => index === 0 ? shape.moveTo(point.x, point.y) : shape.lineTo(point.x, point.y));
    polygon.holes.forEach((hole) => { const path = new THREE.Path(); hole.forEach((point, index) => index === 0 ? path.moveTo(point.x, point.y) : path.lineTo(point.x, point.y)); shape.holes.push(path); });
    return shape;
  }

  function makeWoodTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 256, 0); gradient.addColorStop(0, "#d7b587"); gradient.addColorStop(0.45, "#edcf9f"); gradient.addColorStop(1, "#c99f6c");
    context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 3) { const alpha = 0.04 + ((Math.sin(y * 0.18) + 1) / 2) * 0.05; context.strokeStyle = `rgba(70,42,22,${alpha})`; context.beginPath(); context.moveTo(0, y); for (let x = 0; x <= 256; x += 16) context.lineTo(x, y + Math.sin(x * 0.04 + y * 0.09) * 2.5); context.stroke(); }
    // A few heavier growth lines so the grain direction stays legible once the
    // per-layer rotation is applied.
    for (let line = 0; line < 7; line += 1) { const y = 18 + line * 37.5; context.strokeStyle = "rgba(96,58,30,0.16)"; context.lineWidth = 1.6; context.beginPath(); context.moveTo(0, y); for (let x = 0; x <= 256; x += 8) context.lineTo(x, y + Math.sin(x * 0.03 + line * 2.1) * 4.5); context.stroke(); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1 / 45, 1 / 45); return texture;
  }

  /**
   * Empty `content` and free what this rebuild owned. Objects in `kept` are
   * only detached: they are cached layer bodies the next scene reuses, and
   * their materials live in the cache entry rather than in `resources`.
   */
  function disposeContent(content: THREE.Group, resources: Array<{ dispose: () => void }>, kept?: ReadonlySet<THREE.Object3D>): void {
    for (const child of [...content.children]) {
      content.remove(child);
      if (kept?.has(child)) continue;
      child.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.Line) object.geometry.dispose(); });
    }
    // Every material and texture a rebuild creates is registered here — including
    // ones no object ended up using (no trails, markers, or water in this
    // geometry) — so the traversal above only has to free geometries.
    for (const resource of resources.splice(0)) resource.dispose();
  }

  /** Free every cached layer body, or only the ones this rebuild did not reuse. */
  function disposeLayerCache(cache: Map<string, CachedLayer>, reused?: ReadonlySet<string>): void {
    for (const [id, cached] of cache) {
      if (reused?.has(id)) continue;
      // The meshes themselves were geometry-disposed with the rest of `content`.
      for (const resource of cached.resources) resource.dispose();
      cache.delete(id);
    }
  }

  interface LineBatch { positions: number[]; distances?: number[] }

  /** One polyline as segment pairs, with per-polyline dash distances so dashes restart where a separate Line would. */
  function appendPolyline(batch: LineBatch, points: Point2D[]): void {
    let distance = 0;
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index]!, end = points[index + 1]!;
      batch.positions.push(start.x, start.y, 0, end.x, end.y, 0);
      if (batch.distances) {
        batch.distances.push(distance);
        distance += Math.hypot(end.x - start.x, end.y - start.y);
        batch.distances.push(distance);
      }
    }
  }

  function batchSegments(batch: LineBatch, material: THREE.LineBasicMaterial | THREE.LineDashedMaterial): THREE.LineSegments {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(batch.positions, 3));
    if (batch.distances) geometry.setAttribute("lineDistance", new THREE.Float32BufferAttribute(batch.distances, 1));
    return new THREE.LineSegments(geometry, material);
  }

  // Deterministic per-layer randomness: grain orientation must survive
  // geometry rebuilds without visibly re-rolling, so seed from the layer index.
  function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Each physical layer is cut from its own sheet, so grain direction is
  // uniform within a layer but varies between layers.
  function layerGrainTexture(base: THREE.CanvasTexture, layerIndex: number): THREE.Texture {
    const random = mulberry32(layerIndex + 1);
    const grain = base.clone();
    grain.center.set(0.5, 0.5);
    grain.rotation = random() * Math.PI * 2;
    grain.offset.set(random(), random());
    grain.needsUpdate = true;
    return grain;
  }
  function appendLabel(batch: LineBatch, label: string, origin: Point2D, rotationRad = 0, textStyle?: TextStyleV1): void {
    for (const segment of labelLineSegments(label, origin, 0, 0, rotationRad, textStyle)) batch.positions.push(segment.start.x, segment.start.y, 0, segment.end.x, segment.end.y, 0);
  }

  // Fast path for the exploded slider: only mesh z-positions move, so a drag
  // never tears down or re-extrudes the scene.
  function applyExploded(content: THREE.Group, amount: number): void {
    const layerGap = amount * 13;
    for (const child of content.children) {
      const stacked = child.userData as StackedObject;
      child.position.z = stacked.baseZ + stacked.layerIndex * layerGap;
    }
  }

  function addStacked(content: THREE.Group, object: THREE.Object3D, layerIndex: number, baseZ: number): void {
    object.userData = { layerIndex, baseZ } satisfies StackedObject;
    content.add(object);
  }

  /**
   * Placement draws below its toolbar, in the stage minus the top
   * `--placement-toolbar-space`. The canvas keeps its full size, since resizing
   * a WebGL canvas clears it and would flash (and bare a strip behind the
   * toolbar); the cameras shift their frame down instead, by `viewOffset` of it.
   */
  let toolbarSpace = 0;
  let viewOffset = 0;
  const readToolbarSpace = () => parseFloat(getComputedStyle(container).getPropertyValue("--placement-toolbar-space")) || 0;
  const placementHeight = () => Math.max(container.clientHeight - toolbarSpace, 1);

  /** Aim the perspective camera at the stage below `fraction` of the toolbar space. */
  function applyViewOffset(fraction: number): void {
    if (!runtime) return;
    viewOffset = fraction;
    const { camera } = runtime; const width = Math.max(container.clientWidth, 1); const height = Math.max(container.clientHeight, 1);
    const shift = Math.min(toolbarSpace * fraction, height - 1);
    camera.aspect = width / (height - shift);
    if (shift > 0) camera.setViewOffset(width, height - shift, 0, -shift, width, height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }

  /** Frame the top-down camera exactly like the placement layer's meet-fitted viewBox. */
  function fitTopCamera(): void {
    if (!runtime || !placement) return;
    const available = placementHeight();
    const { halfWidth, halfHeight } = placementFrustum(placementViewBox(geometry.widthMm, geometry.heightMm, placement.marginMm), container.clientWidth, available);
    Object.assign(runtime.topCamera, { left: -halfWidth, right: halfWidth, top: halfHeight + toolbarSpace * (2 * halfHeight / available), bottom: -halfHeight });
    runtime.topCamera.updateProjectionMatrix();
  }

  const TOP_DOWN_EASE_MS = 200;
  let orbitBeforePlacement: { position: THREE.Vector3; target: THREE.Vector3; minDistance: number } | undefined;
  let easeFrame = 0;
  const easeDuration = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : TOP_DOWN_EASE_MS);

  /** Run `apply` with an eased 0→1 fraction over the ease duration, then `done`. */
  function ease(apply: (fraction: number) => void, done: () => void): void {
    cancelAnimationFrame(easeFrame);
    const started = performance.now(); const duration = easeDuration();
    const step = () => {
      if (!runtime) return;
      const t = duration ? Math.min(1, (performance.now() - started) / duration) : 1;
      apply(1 - (1 - t) ** 3);
      runtime.controls.update();
      if (t < 1) easeFrame = requestAnimationFrame(step); else { easeFrame = 0; done(); }
      runtime.requestRender();
    };
    easeFrame = requestAnimationFrame(step);
  }

  /**
   * Straight overhead, at the distance where the perspective camera frames the
   * base like the orthographic one, so swapping cameras at either end of the
   * ease does not jump. A hair of y offset keeps OrbitControls' lookAt defined.
   */
  function overheadPosition(): THREE.Vector3 {
    const { halfHeight } = placementFrustum(placementViewBox(geometry.widthMm, geometry.heightMm, placement?.marginMm ?? 0), container.clientWidth, placementHeight());
    return new THREE.Vector3(0, -0.001, halfHeight / Math.tan(THREE.MathUtils.degToRad(runtime!.camera.fov) / 2));
  }

  /** Ease the orbit camera overhead and collapse the stack, then switch to the orthographic camera. */
  function enterTopDown(): void {
    if (!runtime || orbitBeforePlacement) return;
    const { camera, controls, content } = runtime;
    orbitBeforePlacement = { position: camera.position.clone(), target: controls.target.clone(), minDistance: controls.minDistance };
    controls.enabled = false;
    controls.minDistance = 0;
    toolbarSpace = readToolbarSpace();
    fitTopCamera();
    const fromPosition = camera.position.clone(); const fromTarget = controls.target.clone();
    const toPosition = overheadPosition(); const toTarget = new THREE.Vector3(0, 0, 0);
    const fromExploded = exploded;
    ease((fraction) => {
      camera.position.lerpVectors(fromPosition, toPosition, fraction);
      controls.target.lerpVectors(fromTarget, toTarget, fraction);
      applyExploded(content, fromExploded * (1 - fraction));
      applyViewOffset(fraction);
    }, () => { if (runtime) runtime.topDown = true; });
  }

  /** Swap back to the orbit camera overhead, then ease it to where it was and re-explode the stack. */
  function leaveTopDown(): void {
    if (!runtime || !orbitBeforePlacement) return;
    const { camera, controls, content } = runtime;
    const back = orbitBeforePlacement; orbitBeforePlacement = undefined;
    runtime.topDown = false;
    const fromPosition = camera.position.clone(); const fromTarget = controls.target.clone();
    const toExploded = exploded;
    ease((fraction) => {
      camera.position.lerpVectors(fromPosition, back.position, fraction);
      controls.target.lerpVectors(fromTarget, back.target, fraction);
      applyExploded(content, toExploded * fraction);
      applyViewOffset(1 - fraction);
    }, () => { controls.minDistance = back.minDistance; controls.enabled = true; });
  }

  onMount(() => {
    const scene = new THREE.Scene(); scene.background = new THREE.Color(isEmbedded() ? getComputedStyle(container).getPropertyValue("--color-bg-editor").trim() || "#e7e8ea" : "#20231d");
    const camera = new THREE.PerspectiveCamera(34, 1, 10, 4_000);
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); }
    catch { onUnavailable?.(); return; }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; container.appendChild(renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(renderer); const room = new RoomEnvironment(); const environmentTarget = pmrem.fromScene(room); room.dispose(); pmrem.dispose(); scene.environment = environmentTarget.texture; scene.environmentIntensity = 0.38;
    // Layer steps read through cast shadows plus a cool fill from the opposite
    // quadrant; the warm key alone left the stepped edges flat. The key light's
    // position and shadow frustum are fitted to the model in the rebuild effect.
    const keyLight = new THREE.DirectionalLight(0xffe7c2, 3.2); keyLight.position.set(-180, -120, 280); keyLight.castShadow = true; keyLight.shadow.mapSize.set(2048, 2048); keyLight.shadow.bias = -0.0002; scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xa8c6e8, 0.85); fillLight.position.set(210, 150, 120); scene.add(fillLight);
    scene.add(new THREE.HemisphereLight(0x9fb8ad, 0x2d2118, 0.9));
    const rig = new THREE.Group(); const content = new THREE.Group(); content.scale.y = -1; rig.add(content); scene.add(rig);
    const topCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 20_000); topCamera.position.set(0, 0, 5_000); topCamera.lookAt(0, 0, 0);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.065; controls.maxPolarAngle = Math.PI * 0.95; controls.minDistance = 120; controls.maxDistance = 1800; controls.target.set(0, 0, 10); camera.position.set(15, -165, 270); controls.update();
    if (rememberCamera && savedCamera) { camera.position.set(...savedCamera.position); controls.target.set(...savedCamera.target); controls.update(); fitDistance = savedCamera.fitDistance; fitTarget = new THREE.Vector3(...savedCamera.fitTarget); }
    const texture = makeWoodTexture();
    let contextLost = false;
    const motionQuery = isEmbedded() ? window.matchMedia("(prefers-reduced-motion: reduce)") : undefined;
    const motion = new PreviewMotion();
    let previousFrame = 0;
    let editingControls = document.activeElement !== document.body && !container.contains(document.activeElement);
    let pointer: { id: number; x: number; y: number } | undefined;
    const onMotionChange = () => {
      motion.reset(); previousFrame = 0;
      controls.enableDamping = !motionQuery?.matches;
      requestRender();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (motionQuery?.matches || placement || event.button !== 0) return;
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointer || pointer.id !== event.pointerId) return;
      motion.drag((event.clientX - pointer.x) / Math.max(container.clientWidth, 1), (event.clientY - pointer.y) / Math.max(container.clientHeight, 1));
    };
    const onPointerEnd = (event: PointerEvent) => { if (pointer?.id === event.pointerId) { pointer = undefined; motion.release(); } };
    if (motionQuery) {
      controls.enableDamping = !motionQuery.matches;
      motionQuery.addEventListener("change", onMotionChange);
      renderer.domElement.addEventListener("pointerdown", onPointerDown);
      renderer.domElement.addEventListener("pointermove", onPointerMove);
      renderer.domElement.addEventListener("pointerup", onPointerEnd);
      renderer.domElement.addEventListener("pointercancel", onPointerEnd);
      renderer.domElement.addEventListener("lostpointercapture", onPointerEnd);
    }
    let sceneDirty = true;
    let idleRenderInterval = 100;
    const scheduleRender = () => {
      if (!runtime || runtime.frame || contextLost || document.hidden) return;
      runtime.frame = requestAnimationFrame(render);
    };
    const requestRender = () => { sceneDirty = true; scheduleRender(); };
    const render = (now = performance.now()) => {
      if (!runtime) return;
      runtime.frame = 0;
      if (contextLost || document.hidden) return;
      const motionEnabled = Boolean(motionQuery && !motionQuery.matches && !placement);
      const ambient = motionEnabled && !editingControls;
      controls.update();
      // Give edits and camera gestures priority, and limit idle decoration
      // work on software-rendered or complex models.
      if (ambient && !sceneDirty && previousFrame && now - previousFrame < idleRenderInterval) { scheduleRender(); return; }
      if (ambient) {
        const pose = motion.step(previousFrame ? (now - previousFrame) / 1000 : 0);
        rig.rotation.set(pose.x, pose.y, 0);
        rig.position.z = pose.lift * Math.hypot(geometry.widthMm / 2, geometry.heightMm / 2);
      } else if (!motionEnabled) {
        motion.reset(); rig.rotation.set(0, 0, 0); rig.position.z = 0;
      }
      previousFrame = ambient ? now : 0;
      const renderStarted = performance.now();
      renderer.render(scene, runtime.topDown ? runtime.topCamera : camera);
      idleRenderInterval = Math.max(100, Math.min(250, (performance.now() - renderStarted) * 4));
      sceneDirty = false;
      // Only the embedded ambient rig needs continuous frames. Reduced motion,
      // hidden tabs and the standalone studio retain the on-demand loop.
      if (ambient) scheduleRender();
    };
    controls.addEventListener("change", requestRender);
    const updateZoom = () => { zoom = fitDistance / controls.getDistance(); };
    controls.addEventListener("change", updateZoom);
    const resizeObserver = new ResizeObserver(([entry]) => { const width = entry?.contentRect.width ?? 0; const height = entry?.contentRect.height ?? 0; if (width <= 0 || height <= 0) return; if (placement) toolbarSpace = readToolbarSpace(); applyViewOffset(viewOffset); renderer.setSize(width, height, false); fitTopCamera(); stopFrame(); render(); }); resizeObserver.observe(container);
    const stopFrame = () => { if (runtime) { cancelAnimationFrame(runtime.frame); runtime.frame = 0; } };
    const onFocusChange = () => queueMicrotask(() => {
      const active = document.activeElement;
      // Controls can disappear after applying an edit. A focus loss to body
      // must not restart decoration in the middle of the user's workflow.
      if (active && active !== document.body && active !== document.documentElement) editingControls = !container.contains(active);
      previousFrame = 0; requestRender();
    });
    const onControlPointerDown = (event: PointerEvent) => { editingControls = !container.contains(event.target as Node); previousFrame = 0; requestRender(); };
    if (motionQuery) {
      document.addEventListener("pointerdown", onControlPointerDown);
      document.addEventListener("focusin", onFocusChange);
      document.addEventListener("focusout", onFocusChange);
    }
    const onVisibilityChange = () => { previousFrame = 0; if (document.hidden) stopFrame(); else requestRender(); };
    const onContextLost = (event: Event) => { event.preventDefault(); contextLost = true; stopFrame(); };
    const onContextRestored = () => { contextLost = false; renderer.shadowMap.needsUpdate = true; requestRender(); };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", onVisibilityChange);
    const detachContextHandlers = () => {
      motionQuery?.removeEventListener("change", onMotionChange);
      document.removeEventListener("pointerdown", onControlPointerDown);
      document.removeEventListener("focusin", onFocusChange);
      document.removeEventListener("focusout", onFocusChange);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerEnd);
      renderer.domElement.removeEventListener("pointercancel", onPointerEnd);
      renderer.domElement.removeEventListener("lostpointercapture", onPointerEnd);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      controls.removeEventListener("change", requestRender);
      controls.removeEventListener("change", updateZoom);
    };
    runtime = { renderer, camera, topCamera, topDown: false, controls, rig, content, resizeObserver, frame: 0, environmentTarget, texture, keyLight, detachContextHandlers, requestRender, sceneResources: [], layerMeshes: new Map(), fitSignature: rememberCamera ? savedCamera?.fitSignature : undefined };
    requestRender();
    return () => {
      if (!runtime) return;
      const { position, target } = orbitBeforePlacement ?? { position: runtime.camera.position, target: runtime.controls.target };
      cancelAnimationFrame(easeFrame);
      if (rememberCamera) savedCamera = { position: [position.x, position.y, position.z], target: [target.x, target.y, target.z], fitSignature: runtime.fitSignature, fitDistance, fitTarget: [fitTarget.x, fitTarget.y, fitTarget.z] };
      cancelAnimationFrame(runtime.frame); runtime.detachContextHandlers(); runtime.resizeObserver.disconnect(); disposeContent(runtime.content, runtime.sceneResources); disposeLayerCache(runtime.layerMeshes); runtime.texture.dispose(); runtime.environmentTarget.dispose(); scene.environment = null; runtime.keyLight.shadow.dispose(); runtime.controls.dispose(); runtime.renderer.dispose();
      // Browsers cap live WebGL contexts; release this one now instead of at GC.
      runtime.renderer.forceContextLoss(); runtime.renderer.domElement.remove(); runtime = undefined;
    };
  });

  // Full rebuild only when the modeled content changes. A rename replaces the
  // geometry object but keeps these references, so it does not rebuild the scene.
  const layers = $derived(geometry.layers);
  const waterSurfaces = $derived(geometry.waterSurfaces);
  const waterInserts = $derived(geometry.waterInserts);
  const waterInsertMaterial = $derived(geometry.waterInsertMaterial);
  const lineStyle = $derived(geometry.lineStyle);
  const widthMm = $derived(geometry.widthMm);
  const heightMm = $derived(geometry.heightMm);
  // A string, so an equal prefix list from a new array does not rebuild the scene.
  const hiddenKey = $derived(placement?.hiddenPrefixes.join("|") ?? "");
  const hideMarkings = $derived(placement?.hideMarkings ?? false);
  $effect(() => {
    const omitMarkings = hideMarkings;
    const activeGeometry = { layers, waterSurfaces, waterInserts, waterInsertMaterial, lineStyle, widthMm, heightMm };
    const hiddenPrefixes = hiddenKey ? hiddenKey.split("|") : [];
    const timeout = window.setTimeout(() => {
      if (!runtime) return;
      // Decide what survives before tearing the scene down: a style edit leaves
      // every cut polygon alone, so its bodies are detached and re-added rather
      // than re-extruded.
      const keys = new Map(activeGeometry.layers.map((layer) => [layer.id, layerKey(layer)] as const));
      const reused = new Set([...runtime.layerMeshes].filter(([id, cached]) => cached.key === keys.get(id)).map(([id]) => id));
      const kept = new Set<THREE.Object3D>();
      for (const id of reused) for (const mesh of runtime.layerMeshes.get(id)!.meshes) kept.add(mesh);
      disposeContent(runtime.content, runtime.sceneResources, kept);
      disposeLayerCache(runtime.layerMeshes, reused);
      const style = activeGeometry.lineStyle;
      // The 3D engraving ink is a lighter brown than the flat previews' so it reads on lit wood.
      const engraveMaterial = new THREE.LineBasicMaterial({ color: 0x39291d, linewidth: style.annotationMm });
      const majorRoadMaterial = new THREE.LineBasicMaterial({ color: MARKING_COLORS["major-road"], linewidth: style.majorRoadMm });
      const localRoadMaterial = new THREE.LineBasicMaterial({ color: MARKING_COLORS["local-road"], linewidth: style.localRoadMm });
      const trailMaterial = style.trailPattern === "solid"
        ? new THREE.LineBasicMaterial({ color: MARKING_COLORS.trail, linewidth: style.trailMm })
        : new THREE.LineDashedMaterial({
            color: MARKING_COLORS.trail,
            linewidth: style.trailMm,
            dashSize: style.trailPattern === "dotted" ? 0.05 : Math.max(style.trailMm * 6, 1.2),
            gapSize: Math.max(style.trailMm * 4, 0.7),
          });
      const scoreMaterial = new THREE.LineBasicMaterial({ color: MARKING_COLORS.score, linewidth: style.waterMm });
      const boundaryMaterial = new THREE.LineDashedMaterial({ color: MARKING_COLORS.boundary, linewidth: style.boundaryMm, dashSize: Math.max(style.boundaryMm * 8, 1.6), gapSize: Math.max(style.boundaryMm * 5, 1) });
      // WebGL line dashes have no round caps: SVG-style near-zero dots
      // disappear at fitted zoom. Give the preview marks visible length.
      const coordinateGridMaterial = new THREE.LineDashedMaterial({ color: MARKING_COLORS.grid, toneMapped: false, linewidth: style.coordinateGridMm, dashSize: Math.max(style.coordinateGridMm * 2, 0.5), gapSize: Math.max(style.coordinateGridMm * 4, 0.7) });
      const aviationMaterial = new THREE.LineBasicMaterial({ color: MARKING_COLORS.aviation, linewidth: aviationStroke("class-c", style).widthMm });
      const [classDDash = 1.6, classDGap = 1] = aviationStroke("class-d", style).dash ?? [];
      const aviationDashedMaterial = new THREE.LineDashedMaterial({ color: MARKING_COLORS["aviation-dashed"], linewidth: aviationStroke("class-d", style).widthMm, dashSize: classDDash, gapSize: classDGap });
      // Special use airspace is solid; its inside hatching arrives as geometry.
      const specialUseMaterial = new THREE.LineBasicMaterial({ color: MARKING_COLORS["special-use"], linewidth: aviationStroke("special-use", style).widthMm });
      const lineMaterials: Record<MarkingStyleKey, THREE.LineBasicMaterial | THREE.LineDashedMaterial> = {
        score: scoreMaterial, "major-road": majorRoadMaterial, "local-road": localRoadMaterial, trail: trailMaterial,
        boundary: boundaryMaterial, grid: coordinateGridMaterial, aviation: aviationMaterial, "aviation-dashed": aviationDashedMaterial,
        "special-use": specialUseMaterial, engrave: engraveMaterial,
      };
      const labelMaterial = new THREE.LineBasicMaterial({ color: 0x21170f, toneMapped: false, linewidth: style.annotationMm });
      const seamMaterial = new THREE.LineBasicMaterial({ color: 0x1a120b, toneMapped: false });
      const markerFillMaterial = new THREE.MeshBasicMaterial({ color: 0x2b2119, side: THREE.DoubleSide });
      // Water reads as a pane resting over the basin rather than as another
      // sheet of stock, so it is transmissive and never casts a shadow into the
      // recess it is meant to reveal.
      const waterMaterial = new THREE.MeshStandardMaterial({
        // Saturated and a touch darker than it looks in isolation: the room
        // environment washes a mid blue out to frosted glass over pale stock.
        color: 0x14536e, transparent: true, opacity: 0.52, roughness: 0.28, metalness: 0,
        side: THREE.DoubleSide, depthWrite: false,
      });
      // An acrylic insert is a real sheet: clearer and glossier than the
      // floating surface, so the stepped bed below shows through it.
      const acrylicMaterial = new THREE.MeshStandardMaterial({
        color: 0x2f7fb0, transparent: true, opacity: 0.38, roughness: 0.08, metalness: 0,
        side: THREE.DoubleSide, depthWrite: false,
      });
      runtime.sceneResources.push(engraveMaterial, majorRoadMaterial, localRoadMaterial, trailMaterial, scoreMaterial, boundaryMaterial, coordinateGridMaterial, aviationMaterial, aviationDashedMaterial, specialUseMaterial, labelMaterial, seamMaterial, markerFillMaterial, waterMaterial, acrylicMaterial);
      activeGeometry.layers.forEach((layer) => {
        const baseZ = layer.index * layer.materialThicknessMm;
        let cached = runtime!.layerMeshes.get(layer.id);
        if (!cached) {
          const grain = layerGrainTexture(runtime!.texture, layer.index);
          const face = new THREE.MeshStandardMaterial({ color: 0xe2bd88, map: grain, bumpMap: grain, bumpScale: 0.22, roughness: 0.7, metalness: 0.02, ...SURFACE_DEPTH_BIAS });
          // The cut-edge material is per layer, not shared, so a cached layer
          // owns every material its meshes reference and a rebuild that frees
          // the scene's shared materials can never leave one dangling.
          const side = new THREE.MeshStandardMaterial({ color: 0x8b6039, roughness: 0.82, metalness: 0, ...SURFACE_DEPTH_BIAS });
          const meshes = layer.polygons.map((polygon) => {
            const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeFromPolygon(polygon), { depth: layer.materialThicknessMm, bevelEnabled: false, curveSegments: 8 }), [face, side]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            return mesh;
          });
          // Every seam between pieces is drawn, tabs and straight runs alike:
          // butted bodies alone showed a curved joint's side walls but hid
          // straight ones, so some joints read as stray outlines.
          const seams = layer.pieces.length ? sharedPieceEdges(layer.polygons).flatMap(([start, end]) => [start.x, start.y, 0, end.x, end.y, 0]) : [];
          cached = { key: keys.get(layer.id)!, meshes, seams, face, resources: [grain, face, side] };
          runtime!.layerMeshes.set(layer.id, cached);
        }
        const { face } = cached;
        // Every line on a layer that shares a material becomes one draw call.
        const lineBatches = new Map<THREE.LineBasicMaterial | THREE.LineDashedMaterial, LineBatch>();
        const labelBatch: LineBatch = { positions: [] };
        for (const mesh of cached.meshes) addStacked(runtime!.content, mesh, layer.index, baseZ);
        layer.markings.forEach((marking) => {
          if (omitMarkings || hiddenByPrefix(marking.id, hiddenPrefixes)) return;
          if (marking.filled && marking.points.length > 2) {
            const marker = new THREE.Mesh(new THREE.ShapeGeometry(shapeFromPolygon({ outer: marking.points, holes: marking.holes ?? [] })), marking.knockout ? face : markerFillMaterial);
            marker.renderOrder = marking.knockout ? 2 : 3;
            const lift = markingLift(layer.materialThicknessMm) * (marking.knockout ? 1 : 1.25);
            addStacked(runtime!.content, marker, layer.index, baseZ + layer.materialThicknessMm + lift);
          } else if (marking.points.length > 1) {
            const material = lineMaterials[markingStyleKey(marking)];
            let batch = lineBatches.get(material);
            if (!batch) { batch = { positions: [], ...(material instanceof THREE.LineDashedMaterial ? { distances: [] } : {}) }; lineBatches.set(material, batch); }
            appendPolyline(batch, marking.points);
          }
          if (marking.label && marking.points[0]) appendLabel(labelBatch, marking.label, marking.points[0], marking.labelRotationRad, marking.textStyle);
        });
        if (cached.seams.length) lineBatches.set(seamMaterial, { positions: [...cached.seams] });
        for (const [material, batch] of lineBatches) {
          if (batch.positions.length) addStacked(runtime!.content, batchSegments(batch, material), layer.index, baseZ + layer.materialThicknessMm + markingLift(layer.materialThicknessMm));
        }
        if (labelBatch.positions.length) addStacked(runtime!.content, batchSegments(labelBatch, labelMaterial), layer.index, baseZ + layer.materialThicknessMm + markingLift(layer.materialThicknessMm) * 1.5);
      });
      // Acrylic inserts fill their opening from the ledge below, riding the
      // layer they replace when the stack is exploded. Map detail engraved on
      // them sits on their top face.
      (activeGeometry.waterInserts ?? []).forEach((insert) => {
        const layer = activeGeometry.layers[insert.layerIndex];
        if (!layer) return;
        const thickness = activeGeometry.waterInsertMaterial?.thicknessMm ?? layer.materialThicknessMm;
        const baseZ = layer.index * layer.materialThicknessMm;
        insert.polygons.forEach((polygon) => {
          const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shapeFromPolygon(polygon), { depth: thickness, bevelEnabled: false, curveSegments: 8 }), acrylicMaterial);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.renderOrder = 1;
          addStacked(runtime!.content, mesh, layer.index, baseZ);
        });
        if (omitMarkings) return;
        const lineBatches = new Map<THREE.LineBasicMaterial | THREE.LineDashedMaterial, LineBatch>();
        const labelBatch: LineBatch = { positions: [] };
        insert.markings.forEach((marking) => {
          if (marking.knockout || hiddenByPrefix(marking.id, hiddenPrefixes)) return;
          if (marking.points.length > 1 && !marking.filled) {
            const material = lineMaterials[markingStyleKey(marking)];
            let batch = lineBatches.get(material);
            if (!batch) { batch = { positions: [], ...(material instanceof THREE.LineDashedMaterial ? { distances: [] } : {}) }; lineBatches.set(material, batch); }
            appendPolyline(batch, marking.points);
          }
          if (marking.label && marking.points[0]) appendLabel(labelBatch, marking.label, marking.points[0], marking.labelRotationRad, marking.textStyle);
        });
        const top = baseZ + thickness + markingLift(thickness);
        for (const [material, batch] of lineBatches) if (batch.positions.length) addStacked(runtime!.content, batchSegments(batch, material), layer.index, top);
        if (labelBatch.positions.length) addStacked(runtime!.content, batchSegments(labelBatch, labelMaterial), layer.index, top + markingLift(thickness) * 0.5);
      });
      // The surface floats on the top face of the layer holding its waterline,
      // and rides that layer when the stack is exploded. Where a lake became
      // acrylic the acrylic stands in, so only its still-open water floats.
      (activeGeometry.waterSurfaces ?? []).forEach((surface) => {
        const layer = activeGeometry.layers[surface.layerIndex] ?? activeGeometry.layers[0];
        if (!layer) return;
        (surface.openPolygons ?? surface.polygons).forEach((polygon) => {
          const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapeFromPolygon(polygon), 8), waterMaterial);
          mesh.castShadow = false;
          mesh.receiveShadow = false;
          mesh.renderOrder = 1;
          addStacked(runtime!.content, mesh, layer.index, layer.index * layer.materialThicknessMm + layer.materialThicknessMm + markingLift(layer.materialThicknessMm) * 0.5);
        });
      });

      applyExploded(runtime.content, untrack(() => (placement ? 0 : exploded)));
      const radius = Math.hypot(activeGeometry.widthMm / 2, activeGeometry.heightMm / 2);
      // Fit the key light and its shadow frustum to the model, including the
      // fully exploded stack height, so shadows stay crisp at every size.
      const stackHeight = activeGeometry.layers.length * ((activeGeometry.layers[0]?.materialThicknessMm ?? 1) + 13);
      const shadowHalfSize = Math.max(radius * 1.4, stackHeight);
      runtime.keyLight.position.set(-0.5, -0.33, 0.78).normalize().multiplyScalar(radius * 2.6);
      runtime.keyLight.shadow.camera.left = -shadowHalfSize; runtime.keyLight.shadow.camera.right = shadowHalfSize;
      runtime.keyLight.shadow.camera.bottom = -shadowHalfSize; runtime.keyLight.shadow.camera.top = shadowHalfSize;
      runtime.keyLight.shadow.camera.near = radius * 0.4; runtime.keyLight.shadow.camera.far = radius * 6;
      runtime.keyLight.shadow.normalBias = Math.max(radius * 0.003, 0.05);
      runtime.keyLight.shadow.camera.updateProjectionMatrix();
      // The overhead placement camera sits inside the orbit limit until it leaves.
      const currentDistance = runtime.controls.getDistance();
      const minimumDistance = Math.min(radius * 1.2, currentDistance);
      if (orbitBeforePlacement) orbitBeforePlacement.minDistance = minimumDistance; else runtime.controls.minDistance = minimumDistance;
      runtime.controls.maxDistance = Math.max(radius * 8, currentDistance);
      runtime.camera.near = Math.max(radius * 0.15, 0.5); runtime.camera.far = radius * 24; runtime.camera.updateProjectionMatrix();
      const fitSignature = [activeGeometry.widthMm, activeGeometry.heightMm, activeGeometry.layers.length, activeGeometry.layers[0]?.materialThicknessMm ?? 1].join(":");
      if (runtime.fitSignature !== fitSignature) {
        const target = new THREE.Vector3(0, 0, (activeGeometry.layers.length * (activeGeometry.layers[0]?.materialThicknessMm ?? 1)) / 2);
        const direction = runtime.camera.position.clone().sub(runtime.controls.target);
        if (direction.lengthSq() < 1e-6) direction.set(0.15, -1.65, 2.7);
        direction.normalize();
        const verticalFov = THREE.MathUtils.degToRad(runtime.camera.fov);
        const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(runtime.camera.aspect, 0.1));
        const modelRadius = Math.hypot(activeGeometry.widthMm / 2, activeGeometry.heightMm / 2, stackHeight / 2);
        const distance = modelRadius / Math.sin(Math.min(verticalFov, horizontalFov) / 2) * 1.15;
        fitDistance = Math.min(runtime.controls.maxDistance, Math.max(runtime.controls.minDistance, distance));
        fitTarget = target.clone();
        if (!runtime.fitSignature) {
          runtime.controls.target.copy(target);
          runtime.camera.position.copy(target).addScaledVector(direction, fitDistance);
        }
        runtime.fitSignature = fitSignature;
        zoom = fitDistance / runtime.controls.getDistance();
      }
      runtime.controls.update();
      runtime.renderer.shadowMap.needsUpdate = true;
      runtime.requestRender();
    }, 160);
    return () => window.clearTimeout(timeout);
  });

  // Exploded-slider changes only reposition existing meshes.
  $effect(() => {
    const activeExploded = exploded;
    if (runtime && !untrack(() => placement)) { applyExploded(runtime.content, activeExploded); runtime.renderer.shadowMap.needsUpdate = true; runtime.requestRender(); }
  });

  // Placement mode on and off. Reads only whether it is active, so a new
  // margin or prefix list re-fits the camera without replaying the ease.
  const placing = $derived(placement !== undefined);
  $effect(() => {
    if (placing) untrack(enterTopDown); else untrack(leaveTopDown);
  });
  // Draft edits can replace the placement prop. Refit only when its margin or
  // toolbar changes: otherwise every nudge schedules an expensive terrain render.
  // A toolbar row appearing mid-session (the first uploaded graphic) changes the
  // reserved space without resizing anything, so it is read again here.
  const topMargin = $derived(placement?.marginMm);
  const toolbarRows = $derived(placement?.toolbarRows);
  $effect(() => {
    void topMargin; void toolbarRows; void widthMm; void heightMm;
    untrack(() => {
      if (placement && runtime) { toolbarSpace = readToolbarSpace(); applyViewOffset(viewOffset); }
      fitTopCamera(); runtime?.requestRender();
    });
  });

  export function rotateView(): void { handleKeyDown(new KeyboardEvent("keydown", { key: "ArrowLeft" })); }
  export function zoomView(closer: boolean): void { handleKeyDown(new KeyboardEvent("keydown", { key: closer ? "+" : "-" })); }

  function handleKeyDown(event: KeyboardEvent): void {
    if (!runtime || placement) return; if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { const direction = event.key === "ArrowLeft" ? 1 : -1; const relative = runtime.camera.position.clone().sub(runtime.controls.target).applyAxisAngle(new THREE.Vector3(0, 0, 1), direction * 0.12); runtime.camera.position.copy(runtime.controls.target).add(relative); }
    else if (event.key === "ArrowUp" || event.key === "+") runtime.camera.position.lerp(runtime.controls.target, 0.08);
    else if (event.key === "ArrowDown" || event.key === "-") runtime.camera.position.lerp(runtime.controls.target, -0.08);
    runtime.controls.update();
  }
</script>

<button type="button" class="three-stage" bind:this={container} onkeydown={handleKeyDown} aria-label="Interactive 3D preview. Drag or use left and right arrows to orbit; scroll or use up and down arrows to zoom."></button>

{#if isEmbedded()}<AtommZoom value={zoom} min={0.25} max={4} onZoom={setZoom} onFit={fitView} />{/if}
