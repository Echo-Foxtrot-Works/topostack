import type { ProjectConfigV1 } from "@topostack/core";
import { trackUsage } from "$lib/site/usage";

async function shareLink(project: ProjectConfigV1): Promise<string> {
  const { shareLinkFor } = await import("$lib/studio/share-link");
  return shareLinkFor(project, new URL("/studio", window.location.href).toString());
}

/** Copies the design's link; resolves to the status line to show. */
export async function copyShareLink(project: ProjectConfigV1): Promise<string> {
  try {
    await navigator.clipboard.writeText(await shareLink(project));
    trackUsage("share_link_copied", project.outputMode);
    return "Share link copied · anyone with it can open this design";
  } catch (error) {
    return error instanceof Error && error.name !== "NotAllowedError" ? error.message : "Could not copy the share link. Check clipboard permissions and try again.";
  }
}

/**
 * Hands the link to the system share sheet; browsers without one, and share
 * failures, copy it instead. Resolves to the status line to show, or nothing
 * when the maker closed the sheet.
 */
export async function shareDesign(project: ProjectConfigV1): Promise<string | undefined> {
  let url: string;
  try { url = await shareLink(project); } catch (error) { return error instanceof Error ? error.message : "Could not create the share link."; }
  const data = { title: `${project.name.trim() || "Topographic map"} · TopoStack`, text: "A topographic map design made with TopoStack", url };
  if (typeof navigator.share !== "function" || navigator.canShare?.(data) === false) return copyShareLink(project);
  try {
    await navigator.share(data);
    trackUsage("share_link_shared", project.outputMode);
    return "Design shared · anyone with the link can open it";
  } catch (error) {
    // Closing the share sheet is not a failure.
    if (error instanceof Error && error.name === "AbortError") return undefined;
    return copyShareLink(project);
  }
}
