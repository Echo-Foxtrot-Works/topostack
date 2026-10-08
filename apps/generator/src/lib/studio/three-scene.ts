// Scene pieces of the 3D preview that need no renderer, camera or component state.
import * as THREE from "three";
import { labelLineSegments, type GeometryIRV1, type Point2D, type Polygon2D, type TextStyleV1, type WaterSurfaceIR } from "@topostack/core";

export interface CachedLayer {
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
export function layerKey(layer: GeometryIRV1["layers"][number]): string {
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
export const SURFACE_DEPTH_BIAS = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;

// Markings ride above the face they annotate by a fraction of the stock
// thickness, so thin material does not collapse them into the surface.
export function markingLift(materialThicknessMm: number): number { return Math.max(materialThicknessMm * 0.04, 0.05); }

export function shapeFromPolygon(polygon: Polygon2D): THREE.Shape {
  const shape = new THREE.Shape();
  polygon.outer.forEach((point, index) => index === 0 ? shape.moveTo(point.x, point.y) : shape.lineTo(point.x, point.y));
  polygon.holes.forEach((hole) => { const path = new THREE.Path(); hole.forEach((point, index) => index === 0 ? path.moveTo(point.x, point.y) : path.lineTo(point.x, point.y)); shape.holes.push(path); });
  return shape;
}

export function makeWoodTexture(): THREE.CanvasTexture {
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
/** A run of sheets that sit under the same set of open water. */
export interface WaterStainBand { fromLayer: number; toLayer: number; polygons: Polygon2D[] }

/**
 * Open water cut in wood is stained, not glazed: every sheet at or below a
 * waterline takes the stain wherever that lake covers it. A sheet sits under
 * every lake whose waterline is at or above it, so the stack splits into
 * bands at each distinct waterline. Water an acrylic insert fills is left
 * out; the acrylic shows it instead.
 */
export function waterStainBands(surfaces: ReadonlyArray<Pick<WaterSurfaceIR, "layerIndex" | "polygons" | "openPolygons">>): WaterStainBand[] {
  const open = surfaces.map((surface) => ({ layerIndex: surface.layerIndex, polygons: surface.openPolygons ?? surface.polygons })).filter((surface) => surface.polygons.length);
  const waterlines = [...new Set(open.map((surface) => surface.layerIndex))].sort((a, b) => a - b);
  return waterlines.map((toLayer, index) => ({
    fromLayer: index ? waterlines[index - 1]! + 1 : 0,
    toLayer,
    polygons: open.filter((surface) => surface.layerIndex >= toLayer).flatMap((surface) => surface.polygons),
  }));
}

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function polygonBounds(polygons: Polygon2D[]): Bounds {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const polygon of polygons) for (const point of polygon.outer) {
    bounds.minX = Math.min(bounds.minX, point.x); bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y); bounds.maxY = Math.max(bounds.maxY, point.y);
  }
  return bounds;
}

export function boundsOverlap(a: Bounds, b: Bounds): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

// The stain multiplies the lit wood below it, so the grain, shadows and
// layer edges all read through. Strong in blue and weak in red so the result
// on pale stock lands on blue rather than the grey a mid blue gives.
const STAIN_COLOR = "#4f86e6";
// Mask resolution: fine enough that the stain edge hides under the wall of
// the sheet above, capped so a large model stays a few megabytes of texture.
const STAIN_PX_PER_MM = 4;
const STAIN_MAX_PX = 2048;

/**
 * A multiply mask over the bounds of `polygons`: stain colour inside the
 * water, white (no change) everywhere else. UVs on a top face are its x and
 * y in millimetres, so the texture transform maps those onto the canvas.
 * Undefined where there is no 2D canvas to draw on.
 */
export function waterStainMask(polygons: Polygon2D[]): THREE.CanvasTexture | undefined {
  const bounds = polygonBounds(polygons);
  const pad = 1;
  const minX = bounds.minX - pad, minY = bounds.minY - pad;
  const widthMm = bounds.maxX - bounds.minX + pad * 2, heightMm = bounds.maxY - bounds.minY + pad * 2;
  if (!(widthMm > 0 && heightMm > 0)) return undefined;
  const scale = Math.min(STAIN_PX_PER_MM, STAIN_MAX_PX / Math.max(widthMm, heightMm));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(2, Math.ceil(widthMm * scale)); canvas.height = Math.max(2, Math.ceil(heightMm * scale));
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
  // Canvas rows run down, model y runs up: the texture's flipY puts canvas
  // row 0 at v = 1, so drawing y as distance below the top lines them up.
  const trace = (ring: Point2D[]) => ring.forEach((point, index) => {
    const x = (point.x - minX) * scale, y = (minY + heightMm - point.y) * scale;
    if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
  });
  context.fillStyle = STAIN_COLOR;
  for (const polygon of polygons) {
    context.beginPath();
    trace(polygon.outer); context.closePath();
    for (const hole of polygon.holes) { trace(hole); context.closePath(); }
    context.fill("evenodd");
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.repeat.set(1 / widthMm, 1 / heightMm);
  texture.offset.set(-minX / widthMm, -minY / heightMm);
  return texture;
}

export function disposeContent(content: THREE.Group, resources: Array<{ dispose: () => void }>, kept?: ReadonlySet<THREE.Object3D>): void {
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
export function disposeLayerCache(cache: Map<string, CachedLayer>, reused?: ReadonlySet<string>): void {
  for (const [id, cached] of cache) {
    if (reused?.has(id)) continue;
    // The meshes themselves were geometry-disposed with the rest of `content`.
    for (const resource of cached.resources) resource.dispose();
    cache.delete(id);
  }
}

export interface LineBatch { positions: number[]; distances?: number[] }

/** One polyline as segment pairs, with per-polyline dash distances so dashes restart where a separate Line would. */
export function appendPolyline(batch: LineBatch, points: Point2D[]): void {
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

export function batchSegments(batch: LineBatch, material: THREE.LineBasicMaterial | THREE.LineDashedMaterial): THREE.LineSegments {
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
export function layerGrainTexture(base: THREE.CanvasTexture, layerIndex: number): THREE.Texture {
  const random = mulberry32(layerIndex + 1);
  const grain = base.clone();
  grain.center.set(0.5, 0.5);
  grain.rotation = random() * Math.PI * 2;
  grain.offset.set(random(), random());
  grain.needsUpdate = true;
  return grain;
}
export function appendLabel(batch: LineBatch, label: string, origin: Point2D, rotationRad = 0, textStyle?: TextStyleV1): void {
  for (const segment of labelLineSegments(label, origin, 0, 0, rotationRad, textStyle)) batch.positions.push(segment.start.x, segment.start.y, 0, segment.end.x, segment.end.y, 0);
}

// Fast path for the exploded slider: only mesh z-positions move, so a drag
// never tears down or re-extrudes the scene.
export function applyExploded(content: THREE.Group, amount: number): void {
  const layerGap = amount * 13;
  for (const child of content.children) {
    const stacked = child.userData as StackedObject;
    child.position.z = stacked.baseZ + stacked.layerIndex * layerGap;
  }
}

export function addStacked(content: THREE.Group, object: THREE.Object3D, layerIndex: number, baseZ: number): void {
  object.userData = { layerIndex, baseZ } satisfies StackedObject;
  content.add(object);
}
