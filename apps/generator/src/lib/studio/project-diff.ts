import type { ProjectConfigV1 } from "@topostack/core";
import { boundsForProject } from "@topostack/core";

export function sameMapArea(left: ProjectConfigV1, right: ProjectConfigV1): boolean {
  return left.location.lat === right.location.lat && left.location.lon === right.location.lon && left.location.zoom === right.location.zoom &&
    JSON.stringify(boundsForProject(left)) === JSON.stringify(boundsForProject(right));
}
