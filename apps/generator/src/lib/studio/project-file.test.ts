import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT } from "@topostack/core";
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

  it("allows a large file only when it carries charts", async () => {
    await expect(readProjectFile(fileOf({ project: DEFAULT_PROJECT }, 3_000_000))).rejects.toThrow("2 MB or smaller");
    await expect(readProjectFile(fileOf({ project: DEFAULT_PROJECT, charts: [{ id: "a" }] }, 3_000_000))).resolves.toMatchObject({ savedCharts: 1 });
    await expect(readProjectFile(fileOf({ project: DEFAULT_PROJECT, charts: [{ id: "a" }] }, 25_000_000))).rejects.toThrow("24 MB or smaller");
  });

  it("rejects text that is not a project", async () => {
    await expect(readProjectFile(fileOf("not json"))).rejects.toThrow();
    await expect(readProjectFile(fileOf({ project: { widthMm: "wide" } }))).rejects.toThrow();
  });
});
