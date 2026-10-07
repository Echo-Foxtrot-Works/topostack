import { createSyntheticSource, DEFAULT_PROJECT, type ProjectConfigV1, type SourceBundleV1 } from "@topostack/core";
import { boundsForProject } from "@topostack/core";
import { createSamplePreviewSource } from "$lib/domain/sample-preview";
import { resizeSource } from "$lib/studio/source-refresh";

/** Reuse the bundled Crater Lake terrain when opening a project with the same crop. */
export function createProjectPreviewSource(project: ProjectConfigV1): SourceBundleV1 {
  const source = createSamplePreviewSource();
  const bounds = boundsForProject(project);
  const matches = (["west", "east", "north", "south"] as const)
    .every((edge) => Math.abs(bounds[edge] - source.bounds[edge]) < 1e-8);
  // Other locations still need fresh data; never label Crater Lake as their terrain.
  return matches ? resizeSource(source, DEFAULT_PROJECT, project) : createSyntheticSource(project);
}
