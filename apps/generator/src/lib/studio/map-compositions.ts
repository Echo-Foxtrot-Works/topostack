import type { GeometryIRV1, ProjectConfigV1, SourceBundleV1 } from "@topostack/core";

export const COMPOSITIONS = ["streets", "shoreline", "terrain"] as const;
export type MapComposition = typeof COMPOSITIONS[number];

export interface CompositionPreview {
  project: ProjectConfigV1;
  source: SourceBundleV1;
  geometry: GeometryIRV1;
}

/** Compose the map with existing project settings so it can be saved, shared and exported normally. */
export function composeMap(project: ProjectConfigV1, composition: MapComposition): ProjectConfigV1 {
  const streets = composition === "streets";
  const terrain = composition === "terrain";
  return {
    ...project,
    outputMode: terrain ? "stack" : "engraving",
    showEngravingContours: terrain,
    showElevationLabels: terrain,
    showRoads: streets,
    showRail: streets,
    showTrails: false,
    showTransportationLabels: false,
    showWater: true,
    waterFillPattern: composition === "shoreline" ? "ripples" : "none",
    lineStyle: streets
      ? { ...project.lineStyle, majorRoadMm: 0.55, localRoadMm: 0.18, roadStyle: "centerline" }
      : project.lineStyle,
  };
}
