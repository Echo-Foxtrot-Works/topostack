import { flushSync, mount, tick, unmount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, generateGeometry, type Point2D, type ProjectConfigV1 } from "@topostack/core";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";
import { draftProject, graphicPlaceableId, placeableFor, placementContext, type PlaceableId, type PlacementSession } from "./placeables";
import { placementViewBox } from "./viewport";
import PlacementLayer from "./PlacementLayer.svelte";

const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, plaque: undefined };
const geometry = generateGeometry(project, createSamplePreviewSource());
const context = placementContext(geometry);
const MARGIN_MM = 10;
const viewBox = placementViewBox(geometry.widthMm, geometry.heightMm, MARGIN_MM);
/** Screen pixels per artwork millimetre in the stubbed layout. */
const SCALE = 2;
const badge = { id: "graphic-0001", name: "Badge", shapes: [{ outer: [-500, -250, 500, -250, 500, 250, -500, 250] }] };

let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
  vi.unstubAllGlobals();
});

/** Mounts a controlled layer: `onChange` feeds the next session back in, as the studio does. */
function render(options: { project?: ProjectConfigV1; selected?: PlaceableId; interactive?: boolean } = {}) {
  const base = options.project ?? project;
  const state = new SvelteMap<string, PlacementSession>([["session", { selected: options.selected ?? "north", draft: {} }]]);
  const onChange = vi.fn((session: PlacementSession) => { state.set("session", session); });
  const onDone = vi.fn();
  const onCancel = vi.fn();
  component = mount(PlacementLayer, {
    target,
    props: {
      geometry, hiddenPrefixes: ["north-", "scale-"], project: base, context, widthMm: geometry.widthMm, heightMm: geometry.heightMm, marginMm: MARGIN_MM,
      interactive: options.interactive ?? true,
      get session() { return state.get("session")!; },
      onChange, onDone, onCancel,
    },
  });
  flushSync();
  const svg = target.querySelector<SVGSVGElement>("svg[data-placement-layer]")!;
  // jsdom has no layout: lay the SVG out at exactly SCALE pixels per millimetre.
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, x: 0, y: 0, width: viewBox.width * SCALE, height: viewBox.height * SCALE, right: viewBox.width * SCALE, bottom: viewBox.height * SCALE, toJSON: () => ({}) });
  const session = () => state.get("session")!;
  const draft = () => draftProject(base, session());
  return { svg, session, draft, onChange, onDone, onCancel };
}

const handle = (id: PlaceableId) => target.querySelector<SVGPathElement>(`[data-placeable="${id}"]`)!;
/** The toolbar's status line as its parts: what is placed, then each readout. */
const status = () => {
  const line = target.querySelector(".placement-toolbar__status")!;
  const name = line.querySelector("b");
  return name ? [name.textContent, ...[...line.querySelectorAll(".placement-toolbar__size")].map((readout) => readout.textContent)].join(" | ") : line.textContent?.trim();
};
const button = (text: string) => [...target.querySelectorAll<HTMLButtonElement>("button")].find((entry) => entry.textContent?.trim() === text)!;

function key(element: Element, name: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  flushSync();
  return event;
}

function pointer(element: Element, type: string, clientX: number, clientY: number, init: MouseEventInit = {}): MouseEvent {
  (element as Element & { setPointerCapture(id: number): void }).setPointerCapture ??= vi.fn();
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY, ...init });
  Object.defineProperty(event, "pointerId", { value: 7 });
  element.dispatchEvent(event);
  flushSync();
  return event;
}

/** Artwork millimetres to client pixels in the stubbed layout. */
const toClient = ({ x, y }: Point2D) => ({ x: (x - viewBox.x) * SCALE, y: (y - viewBox.y) * SCALE });
const centerOf = (id: PlaceableId, draft: ProjectConfigV1) => placeableFor(id).center(draft, context);

describe("PlacementLayer", () => {
  it("draws a handle per placeable over the shared camera and focuses the selected one", async () => {
    const { svg } = render();
    expect(svg.getAttribute("viewBox")).toBe(`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    expect([...target.querySelectorAll("[data-placeable]")].map((entry) => entry.getAttribute("data-placeable"))).toEqual(["north", "scale"]);
    expect(handle("north").getAttribute("aria-pressed")).toBe("true");
    expect(handle("scale").getAttribute("aria-pressed")).toBe("false");
    expect(handle("north").getAttribute("aria-label")).toContain("Plus and minus change the size.");
    expect(handle("north").getAttribute("aria-label")).not.toContain("Brackets");
    await tick(); await tick();
    expect(document.activeElement).toBe(handle("north"));
    // Only the selected item shows its resize grip; the north arrow does not turn.
    expect(target.querySelector('[data-placement-grip="north"]')).not.toBeNull();
    expect(target.querySelector("[data-placement-grip='scale']")).toBeNull();
    expect(target.querySelector("[data-placement-rotate]")).toBeNull();
    expect(status()).toBe("North arrow | Diameter 24 mm");
  });

  it("selects an item when it takes focus and updates the toolbar", () => {
    const { session, onChange } = render();
    handle("scale").dispatchEvent(new FocusEvent("focus"));
    flushSync();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(session().selected).toBe("scale");
    expect(status()).toBe("Scale bar");
    expect(target.querySelector(".placement-toolbar__hint")?.textContent).not.toContain("resize");
    handle("scale").dispatchEvent(new FocusEvent("focus"));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("nudges with the arrow keys, ten times as far with Shift", () => {
    const { draft } = render();
    const start = centerOf("north", draft());
    expect(key(handle("north"), "ArrowLeft").defaultPrevented).toBe(true);
    expect(centerOf("north", draft()).x).toBeCloseTo(start.x - 1, 3);
    key(handle("north"), "ArrowUp", { shiftKey: true });
    const moved = centerOf("north", draft());
    expect(moved.x).toBeCloseTo(start.x - 1, 3);
    expect(moved.y).toBeCloseTo(start.y - 10, 3);
  });

  it("resizes with plus and minus within the item's range", () => {
    const { draft } = render();
    key(handle("north"), "+");
    expect(draft().northArrowSizeMm).toBe(25);
    key(handle("north"), "=", { shiftKey: true });
    expect(draft().northArrowSizeMm).toBe(30);
    key(handle("north"), "-");
    expect(draft().northArrowSizeMm).toBe(29);
    for (let step = 0; step < 5; step += 1) key(handle("north"), "_", { shiftKey: true });
    expect(draft().northArrowSizeMm).toBe(12);
    expect(status()).toBe("North arrow | Diameter 12 mm");
  });

  it("ignores keys an item has no use for", () => {
    const { onChange } = render();
    for (const name of ["Delete", "[", "]", "x"]) expect(key(handle("north"), name).defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("maps Escape to Cancel and Enter to Done, except on toolbar buttons", () => {
    const { onCancel, onDone } = render();
    key(handle("north"), "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
    key(handle("north"), "Enter");
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(key(button("Cancel"), "Enter").defaultPrevented).toBe(false);
    expect(onDone).toHaveBeenCalledTimes(1);
    button("Done").click();
    button("Cancel").click();
    expect(onDone).toHaveBeenCalledTimes(2);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("drags an item by the pointer distance in millimetres", () => {
    const { draft, onChange } = render({ selected: "scale" });
    const start = centerOf("north", draft());
    const from = toClient(start);
    const down = pointer(handle("north"), "pointerdown", from.x, from.y);
    expect(down.defaultPrevented).toBe(true);
    expect(onChange.mock.calls[0]![0].selected).toBe("north");
    expect(target.querySelector('[data-placement-item="north"]')?.classList.contains("placement-item--dragging")).toBe(true);
    pointer(handle("north"), "pointermove", from.x - 20 * SCALE, from.y - 6 * SCALE);
    const moved = centerOf("north", draft());
    expect(moved.x).toBeCloseTo(start.x - 20, 3);
    expect(moved.y).toBeCloseTo(start.y - 6, 3);
    pointer(handle("north"), "pointerup", from.x - 20 * SCALE, from.y - 6 * SCALE);
    expect(target.querySelector(".placement-item--dragging")).toBeNull();
    const calls = onChange.mock.calls.length;
    pointer(handle("north"), "pointermove", 0, 0);
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  it("scales an item by how far its corner grip is pulled from the center", () => {
    const { draft } = render();
    const center = centerOf("north", draft());
    const grip = target.querySelector<SVGCircleElement>('[data-placement-grip="north"]')!;
    const corner = { x: Number(grip.getAttribute("cx")), y: Number(grip.getAttribute("cy")) };
    const from = toClient(corner);
    pointer(grip, "pointerdown", from.x, from.y);
    const to = toClient({ x: center.x + (corner.x - center.x) * 1.25, y: center.y + (corner.y - center.y) * 1.25 });
    pointer(grip, "pointermove", to.x, to.y);
    expect(draft().northArrowSizeMm).toBeCloseTo(30, 1);
    pointer(grip, "pointerup", to.x, to.y);
  });

  it("ignores input while not interactive", () => {
    const { onChange, onDone, onCancel } = render({ interactive: false });
    expect(target.querySelector(".placement-layer")?.classList.contains("placement-layer--inert")).toBe(true);
    key(handle("north"), "ArrowLeft");
    key(handle("north"), "+");
    key(handle("north"), "Escape");
    key(handle("north"), "Enter");
    pointer(handle("north"), "pointerdown", 100, 100);
    pointer(handle("north"), "pointermove", 140, 100);
    handle("scale").dispatchEvent(new FocusEvent("focus"));
    expect(onChange).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("says nothing is selected when the selection is gone", () => {
    render({ selected: graphicPlaceableId("missing") });
    expect(status()).toBe("Nothing selected");
    expect(target.querySelector("[aria-pressed='true']")).toBeNull();
  });

  describe("graphics", () => {
    const withLibrary: ProjectConfigV1 = { ...project, customGraphics: [badge] };

    async function withGraphic() {
      const parts = render({ project: withLibrary });
      const select = target.querySelector<HTMLSelectElement>("select.placement-add-graphic")!;
      expect([...select.options].map((option) => option.textContent)).toEqual(["Add graphic…", "Badge"]);
      select.value = badge.id;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      flushSync();
      await tick(); await tick();
      const id = parts.session().selected;
      return { ...parts, id, select };
    }

    it("offers no graphic picker without a library", () => {
      render();
      expect(target.querySelector("select.placement-add-graphic")).toBeNull();
    });

    it("adds a library graphic, selects and focuses it, and resets the picker", async () => {
      const { id, draft, select } = await withGraphic();
      expect(id).toMatch(/^graphic:/);
      expect(draft().placedGraphics).toHaveLength(1);
      expect(select.value).toBe("");
      expect(document.activeElement).toBe(handle(id));
      expect(status()).toMatch(/^Badge, engraved \| Size \d+ mm \| 0°$/);
      expect(target.querySelector(`[data-placement-rotate="${id}"]`)).not.toBeNull();
      expect(handle(id).getAttribute("aria-label")).toContain("Delete removes it.");
    });

    it("turns with the bracket keys, coarse and fine", async () => {
      const { id, draft } = await withGraphic();
      key(handle(id), "[");
      expect(draft().placedGraphics![0]!.rotationDeg).toBe(345);
      key(handle(id), "}");
      key(handle(id), "}");
      expect(draft().placedGraphics![0]!.rotationDeg).toBe(347);
      key(handle(id), "]");
      key(handle(id), "{");
      expect(draft().placedGraphics![0]!.rotationDeg).toBe(1);
      expect(status()).toMatch(/\| 1°$/);
    });

    it("switches what the laser does from the toolbar", async () => {
      const { draft } = await withGraphic();
      const radios = [...target.querySelectorAll<HTMLButtonElement>(".placement-operation [role='radio']")];
      expect(radios.map((radio) => [radio.textContent, radio.getAttribute("aria-checked")])).toEqual([["Engrave", "true"], ["Score", "false"], ["Cut", "false"]]);
      expect(target.textContent).not.toContain("The sheet opens when you press Done");
      radios[2]!.click();
      flushSync();
      expect(draft().placedGraphics![0]!.operation).toBe("cut");
      expect(target.textContent).toContain("The sheet opens when you press Done");
    });

    it("removes the graphic with Delete and selects the item before it", async () => {
      const { id, draft, session } = await withGraphic();
      key(handle(id), "Delete");
      expect(draft().placedGraphics).toBeUndefined();
      expect(session().selected).toBe("scale");
      expect(handle(id)).toBeNull();
      await tick(); await tick();
      expect(document.activeElement).toBe(handle("scale"));
    });

    it("removes the graphic from the toolbar button", async () => {
      const { draft } = await withGraphic();
      const remove = target.querySelector<HTMLButtonElement>("button.placement-remove")!;
      expect(remove.getAttribute("aria-label")).toBe("Remove Badge, engraved from the piece");
      remove.click();
      flushSync();
      expect(draft().placedGraphics).toBeUndefined();
      expect(target.querySelector("button.placement-remove")).toBeNull();
    });
  });
});
