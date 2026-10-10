/**
 * Which kind of brought-in data the custom data view is working on.
 *
 * The active section chooses the workspace and its tools in the sidebar rail,
 * and the viewport shows what those tools work on — the chart being clicked, or
 * the map that markers and paths sit on. It lives outside the components for
 * the same reason the chart draft does: switching to another view unmounts
 * both, and coming back somewhere else would lose the maker's place.
 */

import type { ProjectConfigV1 } from "@topostack/core";

export type CustomDataSectionId = "charts" | "markers" | "paths" | "graphics" | "import";

export interface CustomDataSectionInfo {
  id: CustomDataSectionId;
  label: string;
  /** The rail tab's label, short enough to sit under an icon. */
  tab: string;
}

const CUSTOM_DATA_SECTIONS: readonly CustomDataSectionInfo[] = [
  { id: "charts", label: "Depth charts", tab: "Charts" },
  { id: "markers", label: "Markers", tab: "Markers" },
  { id: "paths", label: "Trails & boundaries", tab: "Paths" },
  { id: "graphics", label: "Graphics", tab: "Graphics" },
  { id: "import", label: "Import", tab: "Import" },
];

export const nav = $state<{ section: CustomDataSectionId }>({ section: "charts" });

export function openCustomDataSection(section: CustomDataSectionId): void {
  nav.section = section;
}

/**
 * The sections a project can use. A flat engraving has no lake floor to
 * carve, so it has no depth charts; its markers and paths are still engraved.
 */
export function sectionsFor(outputMode: ProjectConfigV1["outputMode"]): readonly CustomDataSectionInfo[] {
  return outputMode === "engraving" ? CUSTOM_DATA_SECTIONS.filter((section) => section.id !== "charts") : CUSTOM_DATA_SECTIONS;
}
