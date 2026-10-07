import { describe, expect, it } from "vitest";
import { displayLength, millimetersFromDisplay } from "../index.js";
import { MM_PER_INCH } from "./units.js";

describe("units", () => {
  it("converts display input to millimeters and back exactly", () => {
    expect(millimetersFromDisplay(1, "imperial")).toBeCloseTo(MM_PER_INCH, 10);
    expect(millimetersFromDisplay(5, "metric")).toBe(5);
    expect(displayLength(MM_PER_INCH, "imperial")).toBeCloseTo(1, 10);
    expect(displayLength(millimetersFromDisplay(0.118, "imperial"), "imperial")).toBeCloseTo(0.118, 10);
    expect(millimetersFromDisplay(displayLength(0.15, "imperial"), "imperial")).toBeCloseTo(0.15, 10);
  });
});
