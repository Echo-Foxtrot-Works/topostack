export interface LakeDirectorySource {
  archiveSha256?: string;
  id: string;
  name: string;
  url: string;
  license: string;
  kind: "grid" | "contours";
  region: string;
  group: string;
}
export interface LakeDirectoryEntry {
  id: string;
  name: string;
  sourceId: string;
  surveyId: string;
  region: string;
  bounds: [number, number, number, number];
  aliases?: string[];
  note?: string;
}
export interface LakeDirectory {
  schemaVersion: 1;
  updated: string;
  sources: LakeDirectorySource[];
  lakes: LakeDirectoryEntry[];
}
export const depthKindLabel = (kind: LakeDirectorySource["kind"]): string => kind === "contours" ? "Survey contours" : "Surveyed grid";
const normalized = (text: string): string => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function indexLakeDirectory(directory: LakeDirectory) {
  const sources = new Map(directory.sources.map((source) => [source.id, source]));
  return directory.lakes.map((lake) => {
    const source = sources.get(lake.sourceId);
    if (!source) throw new Error("Lake directory references an unknown source.");
    return { ...lake, source, searchText: normalized([lake.name, ...(lake.aliases ?? []), lake.region, lake.surveyId, source.name, source.group, source.region].join(" ")) };
  }).sort((a, b) => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en"));
}
export type IndexedLake = ReturnType<typeof indexLakeDirectory>[number];
export function searchLakes(lakes: IndexedLake[], query: string, region = "", kind = ""): IndexedLake[] {
  const terms = normalized(query).split(" ").filter(Boolean);
  return lakes.filter((lake) => (!region || lake.source.group === region) && (!kind || lake.source.kind === kind) && terms.every((term) => lake.searchText.includes(term)));
}
export function lakeStudioLink(base: string, lake: Pick<LakeDirectoryEntry, "name" | "bounds">): string {
  const [west, south, east, north] = lake.bounds;
  const padX = (east - west) * 0.08;
  const padY = (north - south) * 0.08;
  const bounds = [Math.max(-180, west - padX), Math.max(-85, south - padY), Math.min(180, east + padX), Math.min(85, north + padY)].map((n) => n.toFixed(6));
  return `${base}/studio?${new URLSearchParams({ lake: lake.name, bounds: bounds.join(",") })}`;
}
