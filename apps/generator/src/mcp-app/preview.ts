import { parseProject, type ProjectConfigV1 } from "@topostack/core";
import { decodeShareFragment } from "@topostack/data-contracts/share-link";

/**
 * What the preview needs from a `preview_model` tool result, read defensively:
 * the result comes from the host, and the design is decoded from the studio
 * link and checked like any shared project.
 */
export interface PreviewInput {
  project: ProjectConfigV1;
  studioUrl: string;
  estimatedSheets?: number;
  attribution?: string;
}

export function previewInput(toolResult: unknown): PreviewInput {
  const result = toolResult && typeof toolResult === "object" ? toolResult as { isError?: unknown; structuredContent?: unknown; content?: unknown } : {};
  if (result.isError) {
    const text = Array.isArray(result.content) ? result.content.map((item: { text?: unknown }) => typeof item?.text === "string" ? item.text : "").join("\n") : "";
    throw new Error(text || "The model could not be planned.");
  }
  const structured = result.structuredContent && typeof result.structuredContent === "object" ? result.structuredContent as Record<string, unknown> : {};
  const studioUrl = structured.studioUrl;
  if (typeof studioUrl !== "string") throw new Error("The tool result has no studio link.");
  const url = new URL(studioUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The studio link is not a web address.");
  const project = parseProject(decodeShareFragment(url.hash));
  const plan = structured.plan && typeof structured.plan === "object" ? structured.plan as { sheetCount?: unknown } : undefined;
  const attribution = structured.attribution && typeof structured.attribution === "object" ? (structured.attribution as { text?: unknown }).text : undefined;
  return {
    project,
    studioUrl: url.toString(),
    ...(typeof plan?.sheetCount === "number" ? { estimatedSheets: plan.sheetCount } : {}),
    ...(typeof attribution === "string" ? { attribution } : {}),
  };
}

/**
 * The design as the preview generates it: the same terrain, water and sheet
 * plan, without the engraved details (roads, labels, markers, title) whose
 * placement is most of the generation time and does not change the stack.
 */
export function previewConfig(project: ProjectConfigV1): ProjectConfigV1 {
  // Aviation is engraved detail too, and the preview never loads its archive;
  // airspace in acrylic is built only in the studio, which loads its stage.
  const { plaque: _plaque, placedGraphics: _placed, aviation: _aviation, airspaceStack: _airspace, ...rest } = project;
  return {
    ...rest,
    showRoads: false,
    showTrails: false,
    showTransportationLabels: false,
    showBoundaries: false,
    showCoordinateGrid: false,
    showElevationLabels: false,
    showNorthArrow: false,
    showScaleBar: false,
    showAlignmentGuides: false,
    showAssemblyLabels: false,
    markers: [],
    customLines: [],
    // The preview is one piece per sheet; the studio splits for the laser bed.
    workAreaWidthMm: 0,
    workAreaHeightMm: 0,
  };
}
