import { DEFAULT_PROJECT, type ProjectConfigV1 } from "@topostack/core";
import { starterById } from "$lib/site/starters";

/** Every starter is a fresh design; saved machine settings cannot leak into it. */
export function starterProject(id: string): ProjectConfigV1 | undefined {
  const starter = starterById(id);
  if (!starter) return undefined;
  const lake = id === "lake";
  return {
    ...structuredClone(DEFAULT_PROJECT),
    id: `topostack-starter-${id}`,
    name: `Crater Lake · ${starter.title}`,
    widthMm: lake ? 200 : 150,
    heightMm: lake ? 150 : 100,
    outputMode: id === "engraving" ? "engraving" : "stack",
    materialThicknessMm: 3,
    verticalExaggeration: lake ? 2 : 1,
    showWaterDepth: lake,
    showRoads: false,
    showTrails: false,
    showElevationLabels: false,
    showNorthArrow: false,
    showScaleBar: false,
    laserKerfMm: 0,
    explodedPreview: 0,
  };
}
