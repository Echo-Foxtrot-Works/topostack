import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import { DEFAULT_PROJECT, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";
import { PlacementController, type PlacementHost } from "$lib/studio/placement/placement-controller.svelte";

const geometry = { widthMm: 300, heightMm: 200 } as GeometryIRV1;

function setup(project: () => ProjectConfigV1 = () => ({ ...DEFAULT_PROJECT, showNorthArrow: true })) {
  const host = {
    project,
    geometry: () => geometry,
    mode: () => "3d" as const,
    threeUnavailable: () => false,
    loadStage: vi.fn(),
    updateFabrication: vi.fn(async (_patch: Partial<ProjectConfigV1>) => {}),
    setStatus: vi.fn(),
  } satisfies PlacementHost;
  let controller!: PlacementController;
  const destroy = $effect.root(() => { controller = new PlacementController(host); });
  flushSync();
  return { host, controller, destroy };
}

describe("PlacementController", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("opens on an available placeable, loads the stage and shows the stack backdrop", () => {
    const { host, controller, destroy } = setup();
    controller.start("north");
    expect(controller.session).toEqual({ selected: "north", draft: {} });
    expect(controller.phase).toBe("editing");
    expect(controller.backdrop).toBe("3d");
    expect(host.loadStage).toHaveBeenCalledOnce();
    destroy();
  });

  it("closes without an edit when Done has no draft", () => {
    const { host, controller, destroy } = setup();
    controller.start("north");
    controller.commit();
    expect(controller.phase).toBe("closing");
    vi.advanceTimersByTime(220);
    expect(controller.session).toBeUndefined();
    expect(host.updateFabrication).not.toHaveBeenCalled();
    destroy();
  });

  it("applies the draft once and closes when the regeneration settles", async () => {
    const { host, controller, destroy } = setup();
    controller.start("north");
    controller.session = { ...controller.session!, draft: { northArrowSizeMm: 30 } };
    controller.commit();
    expect(controller.phase).toBe("settling");
    expect(host.updateFabrication).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.phase).toBe("closing");
    await vi.advanceTimersByTimeAsync(220);
    expect(controller.session).toBeUndefined();
    destroy();
  });

  it("cancels itself once nothing is left to place", () => {
    let project = $state<ProjectConfigV1>({ ...DEFAULT_PROJECT, showNorthArrow: true, showScaleBar: false, plaque: undefined, customGraphics: [], placedGraphics: [] });
    const { controller, destroy } = setup(() => project);
    controller.start("north");
    expect(controller.phase).toBe("editing");
    project = { ...project, showNorthArrow: false };
    flushSync();
    expect(controller.phase).toBe("closing");
    vi.advanceTimersByTime(220);
    expect(controller.session).toBeUndefined();
    destroy();
  });

  it("clears its timers on dispose", () => {
    const { controller, destroy } = setup();
    controller.start("north");
    controller.commit();
    controller.dispose();
    vi.advanceTimersByTime(1_000);
    expect(controller.session).toEqual({ selected: "north", draft: {} });
    destroy();
  });
});
