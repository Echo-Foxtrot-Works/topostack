import { describe, expect, it } from "vitest";
import { createSyntheticSource, DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, generateGeometry } from "../index.js";
import { sourceRequirements } from "./source-requirements.js";

// No test support here: this file runs in a realm that never registered the airspace stage.
describe("airspace without its stage", () => {
  it("asks for airspace volumes only for a layered model that builds airspace", () => {
    expect(sourceRequirements({ ...DEFAULT_PROJECT, airspaceStack: DEFAULT_AIRSPACE_STACK }).airspace).toBe(true);
    expect(sourceRequirements({ ...DEFAULT_PROJECT, outputMode: "engraving", airspaceStack: DEFAULT_AIRSPACE_STACK }).airspace).toBe(false);
    expect(sourceRequirements(DEFAULT_PROJECT).airspace).toBe(false);
  });

  it("builds no airspace and says so, instead of failing the whole model", () => {
    const config = { ...DEFAULT_PROJECT, airspaceStack: DEFAULT_AIRSPACE_STACK };
    const result = generateGeometry(config, { ...createSyntheticSource(config, 24), airspaceVolumes: [] });
    expect(result.airspaceStack).toBeUndefined();
    expect(result.layers.length).toBeGreaterThan(1);
    expect(result.warnings.map((warning) => warning.code)).toContain("AIRSPACE_NOT_LOADED");
  });
});
