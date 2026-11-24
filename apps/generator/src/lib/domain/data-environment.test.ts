import { describe, expect, it } from "vitest";
import { DATA_ENVIRONMENT, servedSources } from "$lib/domain/data-environment";

describe("data environment", () => {
  const sources = [{ id: "open-v1", availability: "all" as const }, { id: "pending-v1", availability: "development" as const }];
  it("keeps sources awaiting approval out of production builds", () => {
    expect(servedSources(sources, "production").map(({ id }) => id)).toEqual(["open-v1"]);
    expect(servedSources(sources, "atomm").map(({ id }) => id)).toEqual(["open-v1"]);
    expect(servedSources(sources, "development").map(({ id }) => id)).toEqual(["open-v1", "pending-v1"]);
  });
  it("treats the test and dev servers as development", () => {
    expect(DATA_ENVIRONMENT).toBe("development");
  });
});
