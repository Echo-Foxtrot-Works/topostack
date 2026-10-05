import { flushSync, mount, unmount } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, type GeometryIRV1 } from "@topostack/core";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";

const three = vi.hoisted(() => ({ renderers: [] as Array<{ dispose: ReturnType<typeof vi.fn>; forceContextLoss: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn>; setSize: ReturnType<typeof vi.fn> }> }));
vi.mock("three", async (importOriginal) => {
  const original = await importOriginal<typeof import("three")>();
  class FakeRenderer {
    domElement = document.createElement("canvas");
    shadowMap = { enabled: false, type: 0 };
    toneMapping = 0; toneMappingExposure = 1; outputColorSpace = "";
    setPixelRatio = vi.fn(); setSize = vi.fn(); render = vi.fn(); dispose = vi.fn(); forceContextLoss = vi.fn();
    constructor() { three.renderers.push(this); }
  }
  class FakePmrem {
    fromScene() { return { texture: new original.Texture(), dispose: vi.fn() }; }
    dispose() {}
  }
  return { ...original, WebGLRenderer: FakeRenderer, PMREMGenerator: FakePmrem };
});

const maplibre = vi.hoisted(() => ({ maps: [] as Array<{ remove: ReturnType<typeof vi.fn>; emit: (type: string, event?: unknown) => void }> }));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({ default: "maplibre-worker.js" }));
vi.mock("maplibre-gl", () => {
  class FakeMap {
    private handlers = new Map<string, Array<(event?: unknown) => void>>();
    remove = vi.fn();
    touchZoomRotate = { disableRotation: vi.fn() };
    constructor() { maplibre.maps.push(this); }
    on(type: string, handler: (event?: unknown) => void) { this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]); return this; }
    once(type: string, handler: (event?: unknown) => void) { return this.on(type, handler); }
    emit(type: string, event: unknown = {}) { for (const handler of this.handlers.get(type) ?? []) handler(event); }
    addControl() { return this; }
    getZoom() { return 11; }
    getCenter() { return { lng: 0, lat: 0 }; }
    isStyleLoaded() { return false; }
    resize() { return this; }
    fitBounds() { return this; }
    stop() { return this; }
    unproject() { return { lng: 0, lat: 0 }; }
  }
  class Control {}
  return { Map: FakeMap, NavigationControl: Control, AttributionControl: Control, Marker: class { setLngLat() { return this; } addTo() { return this; } remove() {} getElement() { return document.createElement("div"); } }, setWorkerUrl: vi.fn() };
});

import MapCanvas from "$lib/studio/MapCanvas.svelte";
import TwoDPreview from "$lib/studio/TwoDPreview.svelte";
import EngravingPreview from "$lib/studio/EngravingPreview.svelte";
import ThreePreview from "$lib/studio/ThreePreview.svelte";
import ThreePreviewHost from "$lib/studio/testing/ThreePreviewHost.svelte";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const resizeCallbacks: ResizeObserverCallback[] = [];

describe("preview resource cleanup", () => {
  let component: ReturnType<typeof mount> | undefined;
  beforeAll(() => {
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class { constructor(callback: ResizeObserverCallback) { resizeCallbacks.push(callback); } observe() {} disconnect() {} unobserve() {} } });
    // jsdom has no 2D canvas; the wood texture only needs drawing calls to exist.
    const context = new Proxy({}, { get: (_target, key) => key === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => undefined, set: () => true });
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", { configurable: true, value: () => context });
  });
  afterEach(async () => { if (component) await unmount(component); component = undefined; three.renderers.length = 0; maplibre.maps.length = 0; resizeCallbacks.length = 0; vi.unstubAllGlobals(); });

  it("merges markings into per-material draw calls and releases GPU resources on unmount", async () => {
    const geometry = generateGeometry({ ...DEFAULT_PROJECT, showTransportationLabels: true }, createSamplePreviewSource());
    const shadowDispose = vi.spyOn(THREE.LightShadow.prototype, "dispose");
    const materialDispose = vi.spyOn(THREE.Material.prototype, "dispose");
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(ThreePreview, { target, props: { geometry, exploded: 0 } });
    flushSync();
    const renderer = three.renderers[0]!;
    // The scene rebuild is deferred briefly so rapid edits do not re-extrude.
    await vi.waitFor(() => expect(renderer.render.mock.calls.some(([scene]) => {
      let lines = 0;
      (scene as THREE.Scene).traverse((object) => { if (object instanceof THREE.Line) lines += 1; });
      return lines > 0;
    })).toBe(true));
    const scene = renderer.render.mock.lastCall![0] as THREE.Scene;
    let lineObjects = 0;
    let segments = 0;
    scene.traverse((object) => {
      if (!(object instanceof THREE.Line)) return;
      lineObjects += 1;
      if ((object.material as THREE.LineBasicMaterial).color.getHex() !== 0x21170f) segments += object.geometry.getAttribute("position").count / 2;
    });
    const polylines = geometry.layers.flatMap((layer) => layer.markings.filter((marking) => !marking.filled && marking.points.length > 1));
    // Every segment survives batching, in far fewer objects than one per marking.
    expect(segments).toBe(polylines.reduce((total, marking) => total + marking.points.length - 1, 0));
    expect(lineObjects).toBeLessThan(polylines.length);
    expect(lineObjects).toBeLessThanOrEqual(geometry.layers.length * 9);

    await unmount(component);
    component = undefined;
    expect(renderer.dispose).toHaveBeenCalledOnce();
    expect(renderer.forceContextLoss).toHaveBeenCalledOnce();
    expect(shadowDispose).toHaveBeenCalled();
    expect(materialDispose).toHaveBeenCalled();
    shadowDispose.mockRestore(); materialDispose.mockRestore();
    target.remove();
  });

  it.each(["cut", "flat"])("preserves filled marker holes in the %s preview", mode => {
    const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    const square = (r: number) => [{x:-r,y:-r},{x:r,y:-r},{x:r,y:r},{x:-r,y:r},{x:-r,y:-r}];
    geometry.layers = [{ ...geometry.layers[0]!, markings: [{ id:"marker-hole",kind:"marker",operation:"engrave",filled:true,points:square(10),holes:[square(2)] }] }];
    const target = document.createElement("div");
    component = mode === "cut" ? mount(TwoDPreview, { target, props: { geometry, selectedLayer:0 } }) : mount(EngravingPreview, { target, props: { geometry, project:DEFAULT_PROJECT,cropShape:"rectangle" } });
    flushSync();
    const path = target.querySelector('[data-marking-id="marker-hole"] path')!;
    expect(path.getAttribute("d")?.match(/M/g)).toHaveLength(2);
    expect(path.getAttribute("fill-rule")).toBe("evenodd");
    expect(path.getAttribute("stroke")).toBe("none");
  });

  it("overlays the paint stencil on a cut layer only when asked", async () => {
    const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    const square = (r: number) => [{x:-r,y:-r},{x:r,y:-r},{x:r,y:r},{x:-r,y:r},{x:-r,y:-r}];
    geometry.layers = [{ ...geometry.layers[0]!, polygons: [{ outer: square(40), holes: [] }], markings: [] }];
    geometry.paintRegions = [{ kind: "water", layerIndex: 0, polygonIndex: 0, polygons: [{ outer: square(10), holes: [square(2)] }] }];
    const target = document.createElement("div");
    component = mount(TwoDPreview, { target, props: { geometry, selectedLayer: 0 } });
    flushSync();
    expect(target.querySelectorAll('path[data-paint-kind="water"]')).toHaveLength(1);
    expect(target.querySelector("[data-paint-template]")).toBeNull();
    const toggle = target.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Show paint template"]')!;
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    toggle.click();
    flushSync();
    const sheets = target.querySelectorAll("[data-paint-template] path");
    // The stencil as cut: the piece with the window as a hole, and the island inside it as its own sheet.
    expect(sheets).toHaveLength(2);
    expect([...sheets].map((sheet) => sheet.getAttribute("d")?.match(/M/g)?.length).sort()).toEqual([1, 2]);
    for (const sheet of sheets) {
      expect(sheet.getAttribute("fill-rule")).toBe("evenodd");
      expect(sheet.getAttribute("stroke")).toBe("#c9302c");
    }
  });

  it("keeps covered marker areas empty in the 3D mesh", async () => {
    const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    const square = (r: number) => [{x:-r,y:-r},{x:r,y:-r},{x:r,y:r},{x:-r,y:r},{x:-r,y:-r}];
    geometry.layers = [{ ...geometry.layers[0]!, polygons: [{outer:square(20),holes:[]}], markings: [{ id:"marker-hole",kind:"marker",operation:"engrave",filled:true,points:square(10),holes:[square(2)] }] }];
    geometry.waterSurfaces = [];
    const target = document.createElement("div");
    component = mount(ThreePreview, { target, props: { geometry, exploded: 0 } });
    flushSync();
    const meshes = () => {
      const scene = three.renderers[0]?.render.mock.lastCall?.[0] as THREE.Scene | undefined;
      const result: THREE.Mesh[] = [];
      scene?.traverse(object => { if (object instanceof THREE.Mesh && object.renderOrder === 3) result.push(object); });
      return result;
    };
    await vi.waitFor(() => expect(meshes()).toHaveLength(1));
    const mesh = meshes()[0]!;
    const positions = mesh.geometry.getAttribute("position");
    const indices = mesh.geometry.index!;
    let area = 0;
    for (let i=0;i<indices.count;i+=3) {
      const a=indices.getX(i), b=indices.getX(i+1), c=indices.getX(i+2);
      area += Math.abs((positions.getX(b)-positions.getX(a))*(positions.getY(c)-positions.getY(a))-(positions.getY(b)-positions.getY(a))*(positions.getX(c)-positions.getX(a)))/2;
    }
    expect(area).toBeCloseTo(384);
  });

  it("renders transportation glyphs and visible grid dashes in the 3D stack", async () => {
    const geometry = generateGeometry({ ...DEFAULT_PROJECT, verticalExaggeration: 4, showTransportationLabels: true, showCoordinateGrid: true, showElevationLabels: false, showNorthArrow: false, showScaleBar: false }, createSamplePreviewSource());
    const labels = geometry.layers.flatMap(layer => layer.markings.filter(mark => mark.id.startsWith("transport-label-")));
    expect(labels.length).toBeGreaterThan(0);
    const target = document.createElement("div");
    component = mount(ThreePreview, { target, props: { geometry, exploded: 0 } });
    flushSync();
    const renderer = three.renderers[0]!;
    const labelLines: THREE.Line[] = [];
    const gridLines: THREE.Line[] = [];
    await vi.waitFor(() => {
      labelLines.length = 0; gridLines.length = 0;
      expect(renderer.render).toHaveBeenCalled();
      (renderer.render.mock.lastCall![0] as THREE.Scene).traverse(object => {
        if (!(object instanceof THREE.Line)) return;
        const material = object.material as THREE.LineBasicMaterial;
        if (material.color.getHex() === 0x21170f) labelLines.push(object);
        if (material.color.getHex() === 0x34404b) gridLines.push(object);
      });
      expect(labelLines.length).toBeGreaterThan(0);
      expect(gridLines.length).toBeGreaterThan(0);
    });
    expect(labelLines.every(line => line.geometry.getAttribute("position").count > 2)).toBe(true);
    for (const line of gridLines) {
      const material = line.material as THREE.LineDashedMaterial;
      // At fitted zoom, marks need a useful duty cycle rather than tiny
      // capless segments that disappear between screen pixels.
      expect(material.dashSize / (material.dashSize + material.gapSize)).toBeGreaterThanOrEqual(0.4);
      expect(material.toneMapped).toBe(false);
    }
  });

  it("re-extrudes only the layers whose cut polygons changed, and still frees them", async () => {
    const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(ThreePreviewHost, { target, props: { initial: geometry } });
    const host = component as unknown as { setGeometry: (next: GeometryIRV1) => void };
    flushSync();
    const renderer = three.renderers[0]!;
    // Layer bodies are the only meshes with a [face, side] material pair.
    const bodies = () => {
      const scene = renderer.render.mock.lastCall![0] as THREE.Scene;
      const meshes: THREE.Mesh[] = [];
      scene.traverse((object) => { if (object instanceof THREE.Mesh && Array.isArray(object.material)) meshes.push(object); });
      return meshes;
    };
    await vi.waitFor(() => { expect(renderer.render).toHaveBeenCalled(); expect(bodies().length).toBeGreaterThan(1); });
    const extrusions = bodies().map((mesh) => mesh.geometry);
    const rebuilt = async (next: GeometryIRV1) => {
      const before = renderer.render.mock.calls.length;
      host.setGeometry(next);
      flushSync();
      await vi.waitFor(() => expect(renderer.render.mock.calls.length).toBeGreaterThan(before));
    };

    // A line-width edit arrives as a fresh worker result: identical cut
    // polygons in brand-new objects, so nothing may be re-triangulated.
    const restyled = structuredClone(geometry);
    restyled.lineStyle = { ...restyled.lineStyle, annotationMm: geometry.lineStyle.annotationMm + 0.1 };
    await rebuilt(restyled);
    expect(bodies().map((mesh) => mesh.geometry)).toHaveLength(extrusions.length);
    expect(bodies().every((mesh, index) => mesh.geometry === extrusions[index])).toBe(true);

    // Moving one vertex rebuilds that layer alone.
    const moved = structuredClone(geometry);
    const changed = moved.layers.findIndex((layer, index) => index > 0 && layer.polygons[0]?.outer.length);
    expect(changed).toBeGreaterThan(0);
    moved.layers[changed]!.polygons[0]!.outer[0]!.x += 1.5;
    await rebuilt(moved);
    const after = bodies();
    expect(after[0]!.geometry).toBe(extrusions[0]);
    expect(after.some((mesh, index) => mesh.geometry !== extrusions[index])).toBe(true);

    // Cached bodies are owned by the preview, not by the rebuild that made
    // them, so unmount has to free them as well.
    const disposals = [vi.spyOn(extrusions[0]!, "dispose"), ...(after[0]!.material as THREE.Material[]).map((material) => vi.spyOn(material, "dispose"))];
    await unmount(component);
    component = undefined;
    for (const dispose of disposals) expect(dispose).toHaveBeenCalled();
    target.remove();
  });

  it("preserves the camera across dimension, thickness and layer-count edits", async () => {
    const update = vi.spyOn(OrbitControls.prototype, "update");
    const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(ThreePreviewHost, { target, props: { initial: geometry } });
    const host = component as unknown as { setGeometry: (next: GeometryIRV1) => void };
    flushSync();
    const renderer = three.renderers[0]!;
    await vi.waitFor(() => expect(renderer.render.mock.calls.some(([scene]) => {
      let meshes = 0;
      (scene as THREE.Scene).traverse(object => { if (object instanceof THREE.Mesh) meshes++; });
      return meshes > 0;
    })).toBe(true));
    const controls = update.mock.contexts.at(-1) as OrbitControls;
    controls.target.set(12, -7, 15);
    controls.object.position.set(130, -230, 450);
    controls.update();
    const position = controls.object.position.clone();
    const orbitTarget = controls.target.clone();
    const next = structuredClone(geometry);
    next.widthMm *= 1.5;
    next.heightMm *= 1.2;
    next.layers = next.layers.slice(0, -1).map(layer => ({ ...layer, materialThicknessMm: layer.materialThicknessMm * 1.5 }));
    renderer.render.mockClear();
    host.setGeometry(next);
    flushSync();
    await new Promise(resolve => setTimeout(resolve, 250));
    expect(renderer.render).toHaveBeenCalled();
    expect(controls.object.position.distanceTo(position)).toBeLessThan(1e-8);
    expect(controls.target.distanceTo(orbitTarget)).toBeLessThan(1e-8);
    update.mockRestore();
    target.remove();
  });

  it("keeps the ambient rig through rebuilds and pauses for reduced motion and hidden tabs", async () => {
    const query = Object.assign(new EventTarget(), { matches: false });
    vi.stubGlobal("matchMedia", () => query);
    const geometry = generateGeometry(DEFAULT_PROJECT, createSamplePreviewSource());
    geometry.layers = geometry.layers.slice(0, 2);
    const target = document.createElement("div");
    document.body.append(target);
    component = mount(ThreePreviewHost, { target, context: new Map([["atomm-embedded", () => true]]), props: { initial: geometry } });
    const host = component as unknown as { setGeometry: (next: GeometryIRV1) => void };
    flushSync();
    const renderer = three.renderers[0]!;
    await vi.waitFor(() => expect(renderer.render).toHaveBeenCalled());
    const scene = renderer.render.mock.lastCall![0] as THREE.Scene;
    const rig = scene.children.find(object => object instanceof THREE.Group)!;
    await vi.waitFor(() => expect(Math.abs(rig.rotation.x)).toBeGreaterThan(0));
    const rail = document.createElement("div");
    rail.className = "gen-rail";
    const field = document.createElement("input");
    rail.append(field); document.body.append(rail);
    const heldRotation = rig.rotation.clone();
    field.focus();
    host.setGeometry({ ...geometry, widthMm: geometry.widthMm + 10 });
    flushSync();
    await new Promise(resolve => setTimeout(resolve, 250));
    expect((renderer.render.mock.lastCall![0] as THREE.Scene).children).toContain(rig);
    expect(rig.rotation.equals(heldRotation)).toBe(true);
    renderer.render.mockClear();
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(renderer.render).not.toHaveBeenCalled();
    rail.remove();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(renderer.render).not.toHaveBeenCalled();
    target.querySelector<HTMLButtonElement>(".three-stage")!.focus();
    await vi.waitFor(() => expect(renderer.render).toHaveBeenCalled());

    query.matches = true;
    query.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(rig.rotation.x).toBe(0));
    await new Promise(resolve => setTimeout(resolve, 50));
    renderer.render.mockClear();
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(renderer.render).not.toHaveBeenCalled();
    expect(rig.position.z).toBe(0);

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    query.matches = false;
    query.dispatchEvent(new Event("change"));
    await new Promise(resolve => setTimeout(resolve, 220));
    expect(renderer.render).not.toHaveBeenCalled();
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(renderer.render).toHaveBeenCalled());
    expect((renderer.render.mock.lastCall![0] as THREE.Scene).children).toContain(rig);
    hidden.mockRestore();

    const stage = target.querySelector(".three-stage")!;
    Object.defineProperty(stage, "clientWidth", { value: 640 });
    Object.defineProperty(stage, "clientHeight", { value: 400 });
    const resize = resizeCallbacks[0]!;
    renderer.setSize.mockClear();
    resize([{ contentRect: { width: 0, height: 0 } }] as ResizeObserverEntry[], {} as ResizeObserver);
    expect(renderer.setSize).not.toHaveBeenCalled();
    resize([{ contentRect: { width: 640, height: 400 } }] as ResizeObserverEntry[], {} as ResizeObserver);
    expect(renderer.setSize).toHaveBeenCalledWith(640, 400, false);
    const camera = renderer.render.mock.lastCall![1] as THREE.PerspectiveCamera;
    expect(camera.aspect).toBe(1.6);
    expect(camera.projectionMatrix.elements.every(Number.isFinite)).toBe(true);
    target.remove();
  });

  it("removes the map on unmount and reports only a style that never loaded", async () => {
    const onUnavailable = vi.fn();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const target = document.createElement("div");
    component = mount(MapCanvas, { target, props: { project: DEFAULT_PROJECT, onUnavailable, onSelectionResize: vi.fn(), onLocationChange: vi.fn() } });
    flushSync();
    const map = maplibre.maps[0]!;
    map.emit("error", { sourceId: "openmaptiles", tile: {}, error: new Error("Tile 503") });
    expect(onUnavailable).not.toHaveBeenCalled();
    map.emit("error", { error: new Error("Style fetch failed") });
    map.emit("error", { error: new Error("Style fetch failed again") });
    expect(onUnavailable).toHaveBeenCalledExactlyOnceWith("load-failed");
    await unmount(component);
    component = undefined;
    expect(map.remove).toHaveBeenCalledOnce();
    warn.mockRestore();

    const loaded = mount(MapCanvas, { target, props: { project: DEFAULT_PROJECT, onUnavailable, onSelectionResize: vi.fn(), onLocationChange: vi.fn() } });
    flushSync();
    const second = maplibre.maps[1]!;
    second.emit("load");
    second.emit("error", { error: new Error("Glyphs unavailable") });
    expect(onUnavailable).toHaveBeenCalledOnce();
    await unmount(loaded);
  });
});
