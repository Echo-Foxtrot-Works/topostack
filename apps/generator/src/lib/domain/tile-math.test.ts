import { describe, expect, it } from "vitest";
import { dataZoom } from "$lib/domain/tile-math";

describe("dataZoom", () => {
  it("rounds the map's fractional zoom and keeps it inside the tile pyramids", () => {
    expect(dataZoom(11.4)).toBe(11);
    expect(dataZoom(11.6)).toBe(12);
    expect(dataZoom(-2)).toBe(0);
    expect(dataZoom(18.3)).toBe(15);
  });
});
