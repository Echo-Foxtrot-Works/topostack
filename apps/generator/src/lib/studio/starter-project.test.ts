import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, parseProject } from "@topostack/core";
import { STARTERS } from "$lib/site/starters";
import { starterProject } from "$lib/studio/starter-project";

describe("first-project starters", () => {
  it("creates valid, independent designs with the promised size and output", () => {
    for (const starter of STARTERS) {
      const project = starterProject(starter.id)!;
      expect(parseProject(project).id).toBe(`topostack-starter-${starter.id}`);
      expect(project).toMatchObject({ widthMm: starter.id === "lake" ? 200 : 150, heightMm: starter.id === "lake" ? 150 : 100, laserKerfMm: 0, showWaterDepth: starter.id === "lake", outputMode: starter.id === "engraving" ? "engraving" : "stack" });
      project.location.label = "Changed";
      expect(starterProject(starter.id)!.location.label).toBe(DEFAULT_PROJECT.location.label);
    }
    expect(starterProject("unknown")).toBeUndefined();
  });
});
