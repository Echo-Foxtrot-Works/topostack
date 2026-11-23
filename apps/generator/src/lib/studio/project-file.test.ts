import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, parseProject } from "@topostack/core";
import { prepareProjectSettings } from "$lib/studio/native-export";
import { readProjectFile } from "$lib/studio/project-file";

vi.mock("$lib/storage/user-charts", () => ({ saveProjectCharts: vi.fn(async (charts: unknown[]) => ({ saved: charts.length, skipped: 0 })) }));

const fileOf = (value: unknown, size?: number) => {
  const file = new File([typeof value === "string" ? value : JSON.stringify(value)], "design.topostack.json", { type: "application/json" });
  return size === undefined ? file : Object.defineProperty(file, "size", { value: size });
};

describe("readProjectFile", () => {
  it("reads a bare project and a project envelope", async () => {
    const project = { ...DEFAULT_PROJECT, name: "Ridge" };
    expect((await readProjectFile(fileOf(project))).project.name).toBe("Ridge");
    const enveloped = await readProjectFile(fileOf({ project }));
    expect(enveloped).toMatchObject({ project: { name: "Ridge" }, savedCharts: 0 });
  });

  it("saves the depth charts a file carries", async () => {
    const result = await readProjectFile(fileOf({ project: DEFAULT_PROJECT, charts: [{ id: "a" }, { id: "b" }] }));
    expect(result.savedCharts).toBe(2);
  });

  it("accepts large projects up to the same byte limit as the settings writer", async () => {
    await expect(readProjectFile(fileOf({ project: DEFAULT_PROJECT }, 3_000_000))).resolves.toMatchObject({ savedCharts: 0 });
    await expect(readProjectFile(fileOf({ project: DEFAULT_PROJECT, charts: [{ id: "a" }] }, 3_000_000))).resolves.toMatchObject({ savedCharts: 1 });
    await expect(readProjectFile(fileOf({ project: DEFAULT_PROJECT, charts: [{ id: "a" }] }, 25_000_000))).rejects.toThrow("24 MB or smaller");
  });

  it("backs up and reimports the largest supported collection of graphic outlines", async () => {
    const outer = Array.from({ length: 3000 }, (_, i) => {
      const angle = i * 2 * Math.PI / 3000;
      return [Math.round(500 * Math.cos(angle)) || 0, Math.round(500 * Math.sin(angle)) || 0];
    }).flat();
    const customGraphics = Array.from({ length: 24 }, (_, i) => ({ id: `graphic-test-${i}`, name: `Graphic ${i}`, shapes: [{ outer }] }));
    const project = parseProject({ ...DEFAULT_PROJECT, customGraphics });
    expect(project.customGraphics).toHaveLength(24);
    const legacy = new File([JSON.stringify({ project }, null, 2)], "old-project.json");
    expect(legacy.size).toBeGreaterThan(2_000_000);
    expect((await readProjectFile(legacy)).project).toEqual(project);
    const saved = prepareProjectSettings(project);
    expect(saved.blob.size).toBeLessThan(2_000_000);
    expect((await readProjectFile(new File([saved.blob], saved.filename))).project).toEqual(project);
  });

  it("rejects text that is not a project", async () => {
    await expect(readProjectFile(fileOf("not json"))).rejects.toThrow();
    await expect(readProjectFile(fileOf({ project: { widthMm: "wide" } }))).rejects.toThrow();
  });
});
