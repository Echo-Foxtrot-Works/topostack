import { describe, expect, it } from "vitest";
import { formatNumber } from "./format.js";

describe("formatNumber", () => {
  it("rounds to three decimals and drops trailing zeros", () => {
    expect(formatNumber(1.23456)).toBe("1.235");
    expect(formatNumber(-12.3456)).toBe("-12.346");
    expect(formatNumber(1.5)).toBe("1.5");
    expect(formatNumber(2)).toBe("2");
    expect(formatNumber(12345.6789)).toBe("12345.679");
  });

  it("hides floating-point noise", () => {
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
    expect(formatNumber(299.99999999)).toBe("300");
  });

  it("never writes negative zero for values that round to zero", () => {
    expect(formatNumber(-0)).toBe("0");
    expect(formatNumber(-0.0004)).toBe("0");
    expect(formatNumber(0.0004)).toBe("0");
  });

  it("keeps sub-millimetre detail at micrometre precision", () => {
    expect(formatNumber(0.15)).toBe("0.15");
    expect(formatNumber(0.0015)).toBe("0.002");
    expect(Number(formatNumber(-0.075))).toBeCloseTo(-0.075, 3);
  });
});
