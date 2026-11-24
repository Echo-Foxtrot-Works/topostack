import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT } from "../types.js";
import { MAX_PROJECT_FILE_BYTES, packageProjectFiles, projectSettingsBlob } from "./project-file.js";

describe("importable projects in complete packages", () => {
  it("keeps generation details above the import limit in a separate file", async () => {
    const project = { ...DEFAULT_PROJECT, name: "Foothills" };
    const result = { detail: "x".repeat(MAX_PROJECT_FILE_BYTES) };
    const attribution = [{ name: "Local survey" }];
    const [settings, receipt] = packageProjectFiles("foothills", { schemaVersion: 1, project, result, attribution });
    expect(settings!.filename).toBe("foothills-project.json");
    expect(settings!.blob.size).toBeLessThan(MAX_PROJECT_FILE_BYTES);
    expect(JSON.parse(await settings!.blob.text())).toEqual({ schemaVersion: 1, project });
    expect(receipt!.filename).toBe("foothills-generation.json");
    const details = JSON.parse(await receipt!.blob.text());
    expect(details.result.detail.length).toBe(MAX_PROJECT_FILE_BYTES);
    expect(details.attribution).toEqual(attribution);
  });

  it("checks the final UTF-8 byte size before offering a backup", () => {
    const chart = { id: "lake", notes: "é".repeat(MAX_PROJECT_FILE_BYTES / 2) };
    expect(() => projectSettingsBlob(DEFAULT_PROJECT, [chart])).toThrow("24 MB");
  });

  it("refuses a project backup with a dangling chart reference", () => {
    const project = { ...DEFAULT_PROJECT, userDepthCharts: { "17": { id: "lake-chart", contentHash: "a".repeat(64) } } };
    expect(() => projectSettingsBlob(project)).toThrow("lake-chart");
    expect(() => packageProjectFiles("lake", { schemaVersion: 1, project })).toThrow("lake-chart");
  });
});
