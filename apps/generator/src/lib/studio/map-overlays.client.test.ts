import { describe, expect, it } from "vitest";
import type { MapMarkerV1, MarkerIconV1 } from "@topostack/core";
import { markerElement } from "$lib/studio/map-overlays";

const pin: MapMarkerV1 = { id: "m1", symbol: "pin", lat: 44.5, lon: -110.5 };
const flag: MarkerIconV1 = { id: "flag", name: "Flag", shapes: [{ outer: [0, 0, 10, 0, 10, 10, 0, 10] }] };

describe("markerElement", () => {
  it("draws a labelled, keyed symbol the map can place", () => {
    const element = markerElement({ ...pin, name: "Camp" }, undefined);
    expect(element.className).toBe("topostack-map-marker");
    expect(element.dataset).toMatchObject({ symbol: "pin", drawing: "pin" });
    expect(element.getAttribute("role")).toBe("img");
    expect(element.getAttribute("aria-label")).toBe("Camp, pin marker at 44.50000, -110.50000");
    expect(element.title).toBe("Camp");
    const path = element.querySelector("svg[aria-hidden=true] path");
    expect(path?.getAttribute("d")).toMatch(/^M/);
    expect(path?.getAttribute("fill-rule")).toBe("evenodd");
  });

  it("draws an uploaded icon and leaves an unnamed marker untitled", () => {
    const element = markerElement({ ...pin, symbol: "custom", iconId: "flag" }, [flag]);
    expect(element.dataset.drawing).toBe("custom:flag:center");
    expect(element.title).toBe("");
    expect(element.getAttribute("aria-label")).toMatch(/^Flag marker/);
  });
});
