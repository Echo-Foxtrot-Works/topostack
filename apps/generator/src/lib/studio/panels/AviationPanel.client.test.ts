import { mount, tick, unmount } from "svelte";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, parseProject, type ProjectConfigV1 } from "@topostack/core";
import type { StudioContext } from "$lib/studio/studio-context";
import AviationPanel from "$lib/studio/panels/AviationPanel.svelte";
import WithStudio from "$lib/studio/testing/WithStudio.svelte";

describe("turning airspace on", () => {
  let component: ReturnType<typeof mount> | undefined;
  let target: HTMLDivElement;
  afterEach(async () => {
    if (component) await unmount(component);
    component = undefined;
    target?.remove();
  });

  it.each([0.5, 1, 3, 10, 12, 25])("starts a valid acrylic model with %s mm terrain stock", async (materialThicknessMm) => {
    const project = { ...DEFAULT_PROJECT, materialThicknessMm };
    const updateFabrication = vi.fn(async (_patch: Partial<ProjectConfigV1>) => {});
    const studio = { project, activeSource: {}, panelSummary: () => "", updateFabrication } as unknown as StudioContext;
    target = document.createElement("div");
    document.body.append(target);
    component = mount(WithStudio, { target, props: { studio, component: AviationPanel } });
    await tick();
    target.querySelector<HTMLButtonElement>('[role="switch"][aria-label="Airspace in 3D"]')!.click();
    expect(updateFabrication).toHaveBeenCalledOnce();
    const patch = updateFabrication.mock.calls[0]![0];
    const next = parseProject({ ...project, ...patch });
    expect(next.airspaceStack).toEqual({ ...DEFAULT_AIRSPACE_STACK, ...(materialThicknessMm < 1 || materialThicknessMm > 10 ? { thicknessMm: 3 } : {}) });
  });
});
