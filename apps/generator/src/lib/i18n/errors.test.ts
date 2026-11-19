import { describe, expect, it } from "vitest";
import { errorText, localMessage } from "$lib/i18n/errors";

describe("known error messages", () => {
  it("map loader and worker messages onto the catalog, keeping English identical", () => {
    expect(localMessage("Terrain service returned 503.")).toBe("Terrain service returned 503.");
    expect(localMessage("Couldn't load the Jost font. Check your connection and try again.")).toBe("Couldn't load the Jost font. Check your connection and try again.");
    expect(localMessage("The geometry engine could not load · reload to update TopoStack")).toBe("The geometry engine could not load · reload to update TopoStack");
    expect(localMessage("Failed to fetch")).toBe("The connection dropped. Check your connection and try again.");
    expect(localMessage("Something unexpected")).toBe("Something unexpected");
  });
  it("falls back when the error carries no message", () => {
    expect(errorText("boom", "Fallback")).toBe("Fallback");
    expect(errorText(new Error(""), "Fallback")).toBe("Fallback");
    expect(errorText(new Error("Lake outlines could not be loaded."), "Fallback")).toBe("Lake outlines could not be loaded.");
  });
});
