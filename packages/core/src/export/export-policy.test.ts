import { describe, expect, it } from "vitest";
import { generateGeometry } from "../pipeline/generate.js";
import { projectFingerprint } from "../pipeline/fingerprint.js";
import { realSource } from "../test-support/sources.js";
import { DEFAULT_PROJECT, type GeometryIRV1, type ProjectConfigV1 } from "../types.js";
import { buildFabricationPackage } from "./packages.js";
import { exportBlockReason } from "./export-policy.js";

describe("exportBlockReason", () => {
  const project = DEFAULT_PROJECT;
  const ir = generateGeometry(project, realSource(project));
  /** The same geometry, as if it had been generated for `config`. */
  const regeneratedFor = (config: ProjectConfigV1, overrides: Partial<GeometryIRV1> = {}): GeometryIRV1 => ({ ...ir, configFingerprint: projectFingerprint(config), ...overrides });

  it("allows real geometry generated from the current settings", () => {
    expect(ir.sourceKind).toBe("real");
    expect(exportBlockReason(ir, project)).toBeUndefined();
  });

  it("blocks synthetic and preview terrain, naming the output being exported", () => {
    expect(exportBlockReason({ ...ir, sourceKind: "synthetic" }, project)).toMatch(/real terrain data before exporting fabrication files/);
    expect(exportBlockReason({ ...ir, sourceKind: "preview" }, project)).toMatch(/real terrain/);
    const engraving = { ...project, outputMode: "engraving" as const };
    expect(exportBlockReason(regeneratedFor(engraving, { sourceKind: "synthetic" }), engraving)).toMatch(/exporting engraving files/);
  });

  it("checks the source before the settings, so a stale synthetic preview asks for real data", () => {
    expect(exportBlockReason({ ...ir, sourceKind: "synthetic" }, { ...project, widthMm: 310 })).toMatch(/real terrain/);
  });

  it("blocks when settings changed after generation or the fingerprint is from an older scheme", () => {
    expect(exportBlockReason(ir, { ...project, materialThicknessMm: 6 })).toMatch(/settings changed/i);
    expect(exportBlockReason({ ...ir, configFingerprint: "" }, project)).toMatch(/settings changed/i);
    expect(exportBlockReason({ ...ir, configFingerprint: ir.configFingerprint.replace(/^v\d+-/, "v1-") }, project)).toMatch(/settings changed/i);
  });

  it("blocks missing or truncated map detail only when the project draws it", () => {
    expect(exportBlockReason({ ...ir, vectorStatus: "partial" }, project)).toMatch(/feature limit/);
    expect(exportBlockReason({ ...ir, vectorStatus: "unavailable" }, project)).toMatch(/Map detail data is unavailable/);
    const plain = { ...project, showRoads: false, showTrails: false, showWater: false, showWaterDepth: false, showBoundaries: false };
    expect(exportBlockReason(regeneratedFor(plain, { vectorStatus: "unavailable" }), plain)).toBeUndefined();
  });

  it("blocks missing lake depth only when water depth is carved", () => {
    expect(exportBlockReason({ ...ir, lakeDataStatus: "unavailable" }, project)).toMatch(/Lake depth data is unavailable/);
    const shallow = { ...project, showWaterDepth: false };
    expect(exportBlockReason(regeneratedFor(shallow, { lakeDataStatus: "unavailable" }), shallow)).toBeUndefined();
  });

  it("blocks a stack with an empty layer but not a flat engraving", () => {
    const emptied = { ...ir, layers: ir.layers.map((layer, index) => index === 1 ? { ...layer, polygons: [] } : layer) };
    expect(exportBlockReason(emptied, project)).toMatch(/layers are empty/);
    const engraving = { ...project, outputMode: "engraving" as const };
    expect(exportBlockReason(regeneratedFor(engraving, { layers: emptied.layers }), engraving)).toBeUndefined();
  });

  it("is the reason the fabrication package builder refuses", () => {
    const changed = { ...project, materialThicknessMm: 6 };
    const reason = exportBlockReason(ir, changed);
    expect(reason).toBeDefined();
    expect(() => buildFabricationPackage(ir, changed)).toThrow(reason!);
  });
});
