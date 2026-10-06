import { createRawSnippet, flushSync, mount, unmount } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SvgViewport from "./SvgViewport.svelte";

const artwork = createRawSnippet(() => ({ render: () => "<g data-artwork></g>" }));
let resize: ResizeObserverCallback | undefined;
let component: ReturnType<typeof mount> | undefined;
let target: HTMLDivElement;

beforeEach(() => {
  resize = undefined;
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {}
    disconnect() {}
  });
  target = document.createElement("div");
  document.body.append(target);
});

afterEach(async () => {
  if (component) await unmount(component);
  component = undefined;
  target.remove();
  vi.unstubAllGlobals();
});

type Props = Partial<{ widthMm: number; heightMm: number; editable: boolean; topLeft: boolean; padding: number; onactivate: (event: MouseEvent) => void; onkeydown: (event: KeyboardEvent) => void; onviewchange: () => void }>;

/** Mounts the viewport; `size` holds the artwork size reactively so a test can change it. */
function render(props: Props = {}, context = new Map<string, unknown>()) {
  const size = new SvelteMap([["width", props.widthMm ?? 100], ["height", props.heightMm ?? 50]]);
  component = mount(SvgViewport, {
    target, context,
    props: {
      ...props,
      get widthMm() { return size.get("width")!; },
      get heightMm() { return size.get("height")!; },
      label: "test", svgLabel: "Test artwork", controlsLabel: "Test zoom controls", resetLabel: "Reset test view", children: artwork,
    },
  });
  flushSync();
  const viewport = target.querySelector<HTMLElement>("[data-svg-viewport]")!;
  const svg = target.querySelector<SVGSVGElement>("svg[aria-label='Test artwork']")!;
  const canvas = target.querySelector<HTMLElement>(".svg-canvas")!;
  return { size, viewport, svg, canvas };
}

/** Lays the canvas out at `width` × `height` pixels, as the browser's observer would. */
function layout(width: number, height: number) {
  resize!([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver);
  flushSync();
}

function key(element: Element, name: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  flushSync();
  return event;
}

function pointer(element: Element, type: string, clientX: number, clientY: number, pointerId = 1): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  element.dispatchEvent(event);
  flushSync();
  return event;
}

const button = (label: string) => target.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
const viewBoxWidth = (svg: SVGSVGElement) => Number(svg.getAttribute("viewBox")!.split(" ")[2]);

describe("SvgViewport", () => {
  it("frames the artwork with padding, centered on the origin or from the top-left corner", async () => {
    const centered = render();
    expect(centered.svg.getAttribute("viewBox")).toBe("-55 -30 110 60");
    expect(centered.svg.querySelector("[data-artwork]")).not.toBeNull();
    expect(centered.viewport.tagName).toBe("BUTTON");
    expect(centered.viewport.getAttribute("aria-label")).toMatch(/^Interactive test preview\./);
    expect(target.querySelector(".svg-zoom-controls")?.getAttribute("aria-label")).toBe("Test zoom controls");
    await unmount(component!);

    expect(render({ topLeft: true }).svg.getAttribute("viewBox")).toBe("-5 -5 110 60");
    await unmount(component!);
    expect(render({ topLeft: true, padding: 0 }).svg.getAttribute("viewBox")).toBe("0 0 100 50");
  });

  it("zooms with the keyboard, previewing first and redrawing sharply once settled", async () => {
    const { viewport, svg } = render();
    expect(button("Zoom out").disabled).toBe(true);
    expect(button("Reset test view").disabled).toBe(true);
    const event = key(viewport, "+");
    expect(event.defaultPrevented).toBe(true);
    expect(viewport.dataset.zoom).toBe("1.50");
    expect(viewport.dataset.rendering).toBe("preview");
    expect(viewBoxWidth(svg)).toBe(110);
    expect(target.querySelector(".svg-zoom-value")?.textContent).toBe("150%");
    await vi.waitFor(() => expect(viewport.dataset.rendering).toBe("sharp"));
    expect(viewBoxWidth(svg)).toBeCloseTo(110 / 1.5);
    expect(button("Zoom out").disabled).toBe(false);
    expect(button("Reset test view").disabled).toBe(false);

    key(viewport, "_");
    expect(viewport.dataset.zoom).toBe("1.00");
    key(viewport, "=");
    key(viewport, "0");
    expect(viewport.dataset.zoom).toBe("1.00");
    expect(viewport.dataset.renderZoom).toBe("1.00");
    expect(svg.getAttribute("viewBox")).toBe("-55 -30 110 60");
  });

  it("clamps zoom between 100% and 600% and disables the matching button", () => {
    const { viewport } = render();
    key(viewport, "-");
    expect(viewport.dataset.zoom).toBe("1.00");
    for (let step = 0; step < 15; step += 1) key(viewport, "+");
    expect(viewport.dataset.zoom).toBe("6.00");
    expect(button("Zoom in").disabled).toBe(true);
    button("Zoom out").click();
    flushSync();
    expect(viewport.dataset.zoom).toBe("5.50");
  });

  it("pans by a tenth of the view with the arrow keys and stops at the pan limit", () => {
    const { viewport, canvas } = render();
    layout(220, 120); // two pixels per millimetre at the fitted zoom
    key(viewport, "ArrowRight");
    expect(canvas.style.transform).toBe("translate3d(-22px, 0px, 0) scale(1)");
    key(viewport, "ArrowDown");
    expect(canvas.style.transform).toBe("translate3d(-22px, -12px, 0) scale(1)");
    expect(button("Reset test view").disabled).toBe(false);
    for (let step = 0; step < 20; step += 1) key(viewport, "ArrowLeft");
    // At 100% the camera may travel the view's width less a tenth: (110 + 110) / 2 - 11 = 99 mm.
    expect(canvas.style.transform).toBe("translate3d(198px, -12px, 0) scale(1)");
    key(viewport, "Home");
    expect(canvas.style.transform).toBe("translate3d(0px, 0px, 0) scale(1)");
    expect(button("Reset test view").disabled).toBe(true);
  });

  it("lets a caller's key handler take a key first and ignores keys it does not use", () => {
    const onkeydown = vi.fn((event: KeyboardEvent) => { if (event.key === "+") event.preventDefault(); });
    const { viewport } = render({ onkeydown });
    key(viewport, "+");
    expect(viewport.dataset.zoom).toBe("1.00");
    expect(key(viewport, "x").defaultPrevented).toBe(false);
    expect(onkeydown).toHaveBeenCalledTimes(2);
  });

  it("reports camera changes", () => {
    const onviewchange = vi.fn();
    const { viewport } = render({ onviewchange });
    onviewchange.mockClear();
    key(viewport, "+");
    expect(onviewchange).toHaveBeenCalled();
    onviewchange.mockClear();
    key(viewport, "x");
    expect(onviewchange).not.toHaveBeenCalled();
  });

  it("zooms with the wheel, scaling line-mode deltas", () => {
    const { viewport } = render();
    layout(220, 120);
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: -10, deltaMode: 1, bubbles: true, cancelable: true }));
    flushSync();
    expect(Number(viewport.dataset.zoom)).toBeCloseTo(Math.exp(10 * 16 * 0.0015), 2);
    viewport.dispatchEvent(new WheelEvent("wheel", { deltaY: 10_000, bubbles: true, cancelable: true }));
    flushSync();
    expect(viewport.dataset.zoom).toBe("1.00");
  });

  it("resets the camera when the artwork changes size", async () => {
    const { viewport, size, svg } = render();
    key(viewport, "+");
    await vi.waitFor(() => expect(viewport.dataset.rendering).toBe("sharp"));
    size.set("width", 200);
    flushSync();
    expect(viewport.dataset.zoom).toBe("1.00");
    expect(svg.getAttribute("viewBox")).toBe("-105 -30 210 60");
  });

  it("uses the Atomm zoom cluster when embedded", () => {
    const { viewport } = render({}, new Map([["atomm-embedded", () => true]]));
    expect(target.querySelector(".svg-zoom-controls")).toBeNull();
    expect(target.querySelector("select[aria-label='Zoom level']")).not.toBeNull();
    button("Zoom in").click();
    flushSync();
    expect(viewport.dataset.zoom).toBe("1.20");
    button("Fit to canvas").click();
    flushSync();
    expect(viewport.dataset.zoom).toBe("1.00");
  });

  describe("editable surfaces", () => {
    function editable() {
      const onactivate = vi.fn();
      const parts = render({ editable: true, onactivate });
      layout(220, 120);
      parts.viewport.setPointerCapture = vi.fn();
      parts.viewport.hasPointerCapture = vi.fn(() => true);
      parts.viewport.releasePointerCapture = vi.fn();
      return { ...parts, onactivate };
    }
    const click = (element: Element, detail = 1) => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail }));
      flushSync();
    };

    it("is a focusable application, not a button", () => {
      const { viewport } = editable();
      expect(viewport.tagName).toBe("DIV");
      expect(viewport.getAttribute("role")).toBe("application");
      expect(viewport.tabIndex).toBe(0);
    });

    it("passes a click through and focuses the surface on press", () => {
      const { viewport, onactivate } = editable();
      const down = pointer(viewport, "pointerdown", 50, 50);
      expect(down.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(viewport);
      pointer(viewport, "pointermove", 52, 51);
      expect(viewport.setPointerCapture).not.toHaveBeenCalled();
      pointer(viewport, "pointerup", 52, 51);
      click(viewport);
      expect(onactivate).toHaveBeenCalledTimes(1);
    });

    it("swallows the click that ends a drag, then pans by the dragged distance", () => {
      const { viewport, canvas, onactivate } = editable();
      pointer(viewport, "pointerdown", 50, 50);
      pointer(viewport, "pointermove", 70, 60);
      expect(viewport.setPointerCapture).toHaveBeenCalledWith(1);
      expect(viewport.classList.contains("dragging")).toBe(true);
      pointer(viewport, "pointerup", 70, 60);
      expect(viewport.classList.contains("dragging")).toBe(false);
      expect(canvas.style.transform).toBe("translate3d(20px, 10px, 0) scale(1)");
      click(viewport);
      expect(onactivate).not.toHaveBeenCalled();
      // Keyboard activation (detail 0) is never a drag's trailing click.
      click(viewport, 0);
      expect(onactivate).toHaveBeenCalledTimes(1);
      // The next plain press clears the suppression.
      pointer(viewport, "pointerdown", 10, 10);
      pointer(viewport, "pointerup", 10, 10);
      click(viewport);
      expect(onactivate).toHaveBeenCalledTimes(2);
    });
  });
});
