import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT } from "../types.js";
import { DEFAULT_AIRSPACE_STACK } from "../pipeline/airspace-settings.js";
import { planTerrainStack } from "../pipeline/stack-plan.js";
import { boundsForProject } from "./bounds.js";
import { planFromRelief } from "./plan.js";

describe("planning from a relief sample", () => {
  it("reports the stack the studio's planner would cut", () => {
    const plan = planFromRelief(DEFAULT_PROJECT, { minM: 1200, maxM: 2700 });
    const stack = planTerrainStack(DEFAULT_PROJECT, 1500, boundsForProject(DEFAULT_PROJECT));
    expect(plan).toMatchObject({
      output: "layered", sheetCount: stack.layerCount, heightOfModelMm: stack.stackHeightMm,
      fittedVerticalExaggeration: stack.verticalExaggeration, requestedVerticalExaggeration: 2, reliefM: 1500,
    });
    expect(plan.scaleDenominator).toBe(Math.round(1 / stack.horizontalScale));
    expect(plan.groundWidthKm).toBeGreaterThan(0);
  });

  it("uses thicker material for fewer sheets", () => {
    const thin = planFromRelief(DEFAULT_PROJECT, { minM: 0, maxM: 1500 });
    const thick = planFromRelief({ ...DEFAULT_PROJECT, materialThicknessMm: 6 }, { minM: 0, maxM: 1500 });
    expect(thick.sheetCount).toBeLessThan(thin.sheetCount);
  });

  it("puts the airspace on the terrain's own vertical scale, up to its cap", () => {
    const config = { ...DEFAULT_PROJECT, verticalExaggeration: 10, airspaceStack: { ...DEFAULT_AIRSPACE_STACK, form: "tiers" as const } };
    const plan = planFromRelief(config, { minM: 1600, maxM: 2500 });
    // 10,000 ft is 3,048 m: 1,448 m over the land base, at the stack's millimetres per metre, on the first sheet, plus the acrylic.
    expect(plan.airspace).toMatchObject({ form: "tiers", ceilingCapFt: 10_000, capIsDefault: true });
    expect(plan.airspace!.topMm).toBeCloseTo(3 + (1448 / plan.metersPerStep) * 3 + 3, 6);
    const capped = planFromRelief({ ...config, airspaceStack: { ...config.airspaceStack, ceilingCapFt: 8_000 } }, { minM: 1600, maxM: 2500 });
    expect(capped.airspace).toMatchObject({ ceilingCapFt: 8_000, capIsDefault: false });
    expect(capped.airspace!.topMm).toBeLessThan(plan.airspace!.topMm!);
    expect(planFromRelief({ ...config, outputMode: "engraving" }, { minM: 1600, maxM: 2500 })).not.toHaveProperty("airspace");
    expect(planFromRelief(DEFAULT_PROJECT, { minM: 1600, maxM: 2500 })).not.toHaveProperty("airspace");
  });

  it("plans flat output as one sheet with a contour interval", () => {
    const plan = planFromRelief({ ...DEFAULT_PROJECT, outputMode: "engraving", engravingContourCount: 10 }, { minM: 100, maxM: 600 });
    expect(plan).toMatchObject({ output: "flat", sheetCount: 1, metersPerStep: 50, heightOfModelMm: DEFAULT_PROJECT.materialThicknessMm });
  });
});
