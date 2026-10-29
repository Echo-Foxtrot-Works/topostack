import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, LAND_CLASSES, parseProject, type ProjectConfigV1 } from "@topostack/core";
import type { StudioContext } from "$lib/studio/studio-context";
import FeaturesPanel from "$lib/studio/panels/FeaturesPanel.svelte";
import WithStudio from "$lib/studio/testing/WithStudio.svelte";

describe("public land paint switches", () => {
  let component: ReturnType<typeof mount> | undefined;
  let target: HTMLDivElement;
  afterEach(async () => {
    if (component) await unmount(component);
    component = undefined;
    target?.remove();
  });

  async function render(project: ProjectConfigV1, activeSource: Record<string, unknown> = {}) {
    const updateFabrication = vi.fn(async (_patch: Partial<ProjectConfigV1>) => {});
    const studio = { project, activeSource, activeLinePreset: undefined, panelSummary: () => "", updateFabrication, updateMapDetails: vi.fn(), navigateChoice: vi.fn(), trailPatternDash: () => "", shownLineWidth: (mm: number) => mm, setLineWidth: vi.fn(), shownLengthUnit: "mm" } as unknown as StudioContext;
    target = document.createElement("div");
    document.body.append(target);
    component = mount(WithStudio, { target, props: { studio, component: FeaturesPanel } });
    await tick();
    return updateFabrication;
  }

  it("offers one switch per land kind on a layered model, and adds a kind beside water", async () => {
    const project = { ...DEFAULT_PROJECT, outputMode: "stack" as const, paintTemplates: ["water" as const] };
    const updateFabrication = await render(project);
    const switches = target.querySelectorAll<HTMLButtonElement>('.land-paint-kinds [role="switch"]');
    expect(switches).toHaveLength(LAND_CLASSES.length);
    target.querySelector<HTMLButtonElement>('[role="switch"][aria-label="National parks paint template"]')!.click();
    const patch = updateFabrication.mock.calls[0]![0];
    expect(patch.paintTemplates).toEqual(["water", "national-park"]);
    expect(parseProject({ ...project, ...patch }).paintTemplates).toEqual(["water", "national-park"]);
  });

  it("turns one kind off and leaves the others", async () => {
    const updateFabrication = await render({ ...DEFAULT_PROJECT, outputMode: "stack", paintTemplates: ["blm", "water", "wilderness"] });
    target.querySelector<HTMLButtonElement>('[role="switch"][aria-label="BLM land paint template"]')!.click();
    expect(updateFabrication.mock.calls[0]![0].paintTemplates).toEqual(["water", "wilderness"]);
  });

  it("engraves boundaries in either mode, and drops the setting with its last class", async () => {
    const updateMapDetails = vi.fn();
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "engraving" };
    const studio = { project, activeSource: {}, activeLinePreset: undefined, panelSummary: () => "", updateFabrication: vi.fn(), updateMapDetails, navigateChoice: vi.fn(), trailPatternDash: () => "", shownLineWidth: (mm: number) => mm, setLineWidth: vi.fn(), shownLengthUnit: "mm" } as unknown as StudioContext;
    target = document.createElement("div");
    document.body.append(target);
    component = mount(WithStudio, { target, props: { studio, component: FeaturesPanel } });
    await tick();
    expect(target.querySelectorAll('.land-boundary-kinds [role="switch"]')).toHaveLength(LAND_CLASSES.length);
    target.querySelector<HTMLButtonElement>('[role="switch"][aria-label="BLM land boundaries"]')!.click();
    expect(updateMapDetails.mock.calls[0]![0]).toEqual({ lands: { boundaries: ["blm"], hatched: false, labels: false } });
    expect(parseProject({ ...project, ...updateMapDetails.mock.calls[0]![0] }).lands).toEqual({ boundaries: ["blm"], hatched: false, labels: false });
    await unmount(component);
    target.remove();
    component = undefined;

    const engraved = { ...project, lands: { boundaries: ["blm" as const], hatched: true, labels: false } };
    const more = { ...studio, project: engraved, updateMapDetails: vi.fn() } as unknown as StudioContext;
    target = document.createElement("div");
    document.body.append(target);
    component = mount(WithStudio, { target, props: { studio: more, component: FeaturesPanel } });
    await tick();
    expect(target.querySelector('[role="switch"][aria-label="Hatch inside public land boundaries"]')).not.toBeNull();
    target.querySelector<HTMLButtonElement>('[role="switch"][aria-label="BLM land boundaries"]')!.click();
    expect(vi.mocked(more.updateMapDetails).mock.calls[0]![0]).toEqual({ lands: undefined });
  });

  it("lists the units in the area and leaves one out, dropping the setting with the last one back in", async () => {
    const park = { unit: "national-park:Rocky Mountain National Park", landClass: "national-park" as const, name: "Rocky Mountain National Park", polygons: [] };
    const blm = { unit: "blm:CO", landClass: "blm" as const, polygons: [] };
    const updateMapDetails = vi.fn();
    const project: ProjectConfigV1 = { ...DEFAULT_PROJECT, outputMode: "stack", paintTemplates: ["national-park", "blm"] };
    const studio = { project, activeSource: { landAreas: [park, blm] }, activeLinePreset: undefined, panelSummary: () => "", updateFabrication: vi.fn(), updateMapDetails, navigateChoice: vi.fn(), trailPatternDash: () => "", shownLineWidth: (mm: number) => mm, setLineWidth: vi.fn(), shownLengthUnit: "mm" } as unknown as StudioContext;
    target = document.createElement("div");
    document.body.append(target);
    component = mount(WithStudio, { target, props: { studio, component: FeaturesPanel } });
    await tick();
    expect([...target.querySelectorAll('.land-units [role="switch"]')].map((item) => item.getAttribute("aria-label"))).toEqual(["Include Rocky Mountain National Park", "Include BLM land, CO"]);
    target.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Include BLM land, CO"]')!.click();
    expect(updateMapDetails.mock.calls[0]![0]).toEqual({ landExclusions: ["blm:CO"] });
    await unmount(component);
    target.remove();
    const leftOut = { ...studio, project: { ...project, landExclusions: ["blm:CO"] }, updateMapDetails: vi.fn() } as unknown as StudioContext;
    target = document.createElement("div");
    document.body.append(target);
    component = mount(WithStudio, { target, props: { studio: leftOut, component: FeaturesPanel } });
    await tick();
    target.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Include BLM land, CO"]')!.click();
    expect(vi.mocked(leftOut.updateMapDetails).mock.calls[0]![0]).toEqual({ landExclusions: undefined });
  });

  it("says when the area is outside PAD-US, and hides the switches for a flat engraving", async () => {
    await render({ ...DEFAULT_PROJECT, outputMode: "stack", paintTemplates: ["national-forest"] }, { landsStatus: "not-covered" });
    expect(target.textContent).toContain("No public land of these kinds here");
    await unmount(component!);
    target.remove();
    component = undefined;
    await render({ ...DEFAULT_PROJECT, outputMode: "engraving" });
    expect(target.querySelector(".land-paint-kinds")).toBeNull();
    expect(target.querySelector(".land-boundary-kinds")).not.toBeNull();
  });
});
