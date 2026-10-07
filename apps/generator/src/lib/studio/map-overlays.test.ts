import { describe, expect, it } from "vitest";
import { DEFAULT_PROJECT, type MapMarkerV1, type MarkerIconV1 } from "@topostack/core";
import { customLineData, draftData, mapAreaData, markerDrawingKey, markerLabel, markerPixelOffset, roundDegrees, wrapLongitude } from "$lib/studio/map-overlays";

const pin: MapMarkerV1 = { id: "m1", symbol: "pin", lat: 44.123456789, lon: -110.5 };
const flag: MarkerIconV1 = { id: "flag", name: "Flag", anchor: "bottom", shapes: [{ outer: [0, 0, 10, 0, 10, 10, 0, 10] }] };
const world = { west: -180, east: 180, south: -85, north: 85 };

describe("marker helpers", () => {
  it("labels a marker by name, symbol and position", () => {
    expect(markerLabel(pin, undefined)).toBe("pin marker at 44.12346, -110.50000");
    expect(markerLabel({ ...pin, name: "Camp", symbol: "custom", iconId: "flag" }, [flag])).toBe("Camp, Flag marker at 44.12346, -110.50000");
  });

  it("keys a marker's drawing on its symbol, or its icon and anchor", () => {
    expect(markerDrawingKey(pin, undefined)).toBe("pin");
    expect(markerDrawingKey({ ...pin, symbol: "custom", iconId: "flag" }, [flag])).toBe("custom:flag:bottom");
    expect(markerDrawingKey({ ...pin, symbol: "custom", iconId: "flag" }, [{ ...flag, anchor: undefined }])).toBe("custom:flag:center");
  });

  it("offsets only markers whose anchor is off-centre", () => {
    expect(markerPixelOffset({ ...pin, symbol: "circle" }, undefined)).toEqual([0, 0]);
    const [, y] = markerPixelOffset({ ...pin, symbol: "custom", iconId: "flag" }, [flag]);
    expect(y).not.toBe(0);
  });

  it("wraps longitudes into one world and rounds clicks to six decimals", () => {
    expect(wrapLongitude(190)).toBe(-170);
    expect(wrapLongitude(-540)).toBe(-180);
    expect(roundDegrees(44.1234564)).toBe(44.123456);
  });
});

describe("overlay data", () => {
  it("unwraps custom line longitudes into the project's window", () => {
    const data = customLineData([{ id: "l1", kind: "trail", points: [{ lat: 1, lon: 179 }, { lat: 1, lon: -179 }] }] as never, { west: 170, east: 190, south: -10, north: 10 });
    expect(data.features[0]!.geometry.coordinates).toEqual([[179, 1], [181, 1]]);
    expect(data.features[0]!.properties).toEqual({ id: "l1", kind: "trail" });
  });

  it("outlines the map area as a closed box or a 73-point ellipse, and nothing when hidden", () => {
    expect(mapAreaData(DEFAULT_PROJECT, false).features).toHaveLength(0);
    const box = mapAreaData({ ...DEFAULT_PROJECT, cropShape: "rectangle" }, true).features[0]!.geometry.coordinates;
    expect(box).toHaveLength(5);
    expect(box[0]).toEqual(box[4]);
    const circle = mapAreaData({ ...DEFAULT_PROJECT, cropShape: "circle" }, true).features[0]!.geometry.coordinates;
    expect(circle).toHaveLength(73);
  });

  it("draws the path so far, the segment to the pointer, and a dot per point", () => {
    expect(draftData([], { lat: 0, lon: 0 }, world).features).toHaveLength(0);
    const one = draftData([{ lat: 0, lon: 0 }], { lat: 1, lon: 1 }, world).features;
    expect(one.map((feature) => feature.properties)).toEqual([{ rubber: true }, { first: true }]);
    const three = draftData([{ lat: 0, lon: 0 }, { lat: 1, lon: 0 }, { lat: 1, lon: 1 }], undefined, world).features;
    expect(three.map((feature) => feature.geometry.type)).toEqual(["LineString", "Point", "Point", "Point"]);
    expect(three.slice(1).map((feature) => feature.properties)).toEqual([{ first: true }, { first: false }, { first: false }]);
  });
});
