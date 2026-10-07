import { afterEach, describe, expect, it } from "vitest";
import { isTerrainRefused, recordTerrainRefusal, resetTerrainRefusals } from "../src/terrain-refusal";

afterEach(() => resetTerrainRefusals());

describe("terrain refusal memory", () => {
  it("refuses a client for one limiter window after it went over budget", () => {
    recordTerrainRefusal("203.0.113.7", 1_000);
    expect(isTerrainRefused("203.0.113.7", 1_001)).toBe(true);
    expect(isTerrainRefused("198.51.100.2", 1_001)).toBe(false);
    expect(isTerrainRefused("203.0.113.7", 61_000)).toBe(false);
    // An expired entry is forgotten, not refused again later.
    expect(isTerrainRefused("203.0.113.7", 1_002)).toBe(false);
  });

  it("stays bounded, dropping expired clients first and then the oldest", () => {
    for (let index = 0; index < 1_000; index += 1) recordTerrainRefusal(`old-${index}`, 0);
    recordTerrainRefusal("fresh", 60_000);
    // Every old entry expired at 60 s, so they all made room.
    expect(isTerrainRefused("old-0", 60_001)).toBe(false);
    expect(isTerrainRefused("fresh", 60_001)).toBe(true);

    resetTerrainRefusals();
    for (let index = 0; index < 1_000; index += 1) recordTerrainRefusal(`live-${index}`, 0);
    recordTerrainRefusal("newest", 1);
    expect(isTerrainRefused("live-0", 2)).toBe(false);
    expect(isTerrainRefused("live-1", 2)).toBe(true);
    expect(isTerrainRefused("newest", 2)).toBe(true);
  });
});
