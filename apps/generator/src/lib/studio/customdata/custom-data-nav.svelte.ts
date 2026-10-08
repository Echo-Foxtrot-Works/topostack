/**
 * Which kind of brought-in data the custom data view is working on.
 *
 * The active section chooses the workspace; tools can collapse independently, and
 * the viewport shows what those tools work on — the chart being clicked, or
 * the map that markers and paths sit on. It lives outside the components for
 * the same reason the chart draft does: switching to another view unmounts
 * both, and coming back somewhere else would lose the maker's place.
 */

import type { ProjectConfigV1 } from "@topostack/core";

export type CustomDataSectionId = "charts" | "markers" | "paths" | "graphics" | "import";

export interface CustomDataSectionInfo {
  id: CustomDataSectionId;
  label: string;
}

const CUSTOM_DATA_SECTIONS: readonly CustomDataSectionInfo[] = [
  { id: "charts", label: "Depth charts" },
  { id: "markers", label: "Markers" },
  { id: "paths", label: "Trails & boundaries" },
  { id: "graphics", label: "Graphics" },
  { id: "import", label: "Import" },
];

// Disclosure state is independent: collapsing tools keeps the workspace and draft.
export const nav = $state<{ section: CustomDataSectionId; expanded: boolean }>({ section: "charts", expanded: true });

export function openCustomDataSection(section: CustomDataSectionId): void {
  nav.section = section;
  nav.expanded = true;
}

/** @public CustomDataNav.svelte calls this only from its markup, which knip does not read. */
export function toggleCustomDataSection(section: CustomDataSectionId): void {
  if (nav.section === section) nav.expanded = !nav.expanded;
  else openCustomDataSection(section);
}

/**
 * The sections a project can use. A flat engraving has no lake floor to
 * carve, so it has no depth charts; its markers and paths are still engraved.
 */
export function sectionsFor(outputMode: ProjectConfigV1["outputMode"]): readonly CustomDataSectionInfo[] {
  return outputMode === "engraving" ? CUSTOM_DATA_SECTIONS.filter((section) => section.id !== "charts") : CUSTOM_DATA_SECTIONS;
}
