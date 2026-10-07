import { describe, expect, it } from "vitest";
import { keepsPendingWork, refreshKindFor } from "$lib/studio/edit-classification";

describe("keepsPendingWork", () => {
  it("lets renames and preview-only settings leave work running", () => {
    expect(keepsPendingWork(["name"], false)).toBe(true);
    expect(keepsPendingWork(["explodedPreview", "sheetNesting", "waterInsertSheetNesting"], false)).toBe(true);
  });

  it("lets styling keep a running Generate, but not a refresh", () => {
    expect(keepsPendingWork(["lineStyle", "textStyle"], true)).toBe(true);
    expect(keepsPendingWork(["lineStyle"], false)).toBe(false);
  });

  it("stops work for anything else, and for an empty patch", () => {
    expect(keepsPendingWork(["widthMm"], true)).toBe(false);
    expect(keepsPendingWork(["name", "widthMm"], false)).toBe(false);
    expect(keepsPendingWork([], true)).toBe(false);
  });
});

describe("refreshKindFor", () => {
  it("needs no refresh for cosmetic differences", () => {
    expect(refreshKindFor([])).toBeUndefined();
    expect(refreshKindFor(["name", "explodedPreview"])).toBeUndefined();
  });

  it("treats any show* switch as a map-detail refresh", () => {
    expect(refreshKindFor(["showRoads", "markers"])).toBe("details");
  });

  it("refreshes custom data alone as custom data, and everything else as fabrication", () => {
    expect(refreshKindFor(["markers", "customLines", "name"])).toBe("fabrication");
    expect(refreshKindFor(["markers", "placedGraphics"])).toBe("customData");
    expect(refreshKindFor(["widthMm"])).toBe("fabrication");
  });
});
