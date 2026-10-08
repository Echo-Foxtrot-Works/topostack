/** Lightweight descriptions also used on the homepage; no studio code here. */
export const STARTERS = [
  { id: "relief", title: "Small layered relief", description: "A compact Crater Lake landscape with a simpler stack and no lake-floor carving.", size: "150 × 100 mm · 3 mm sheets", guide: "/guides/laser-cut-topographic-map" },
  { id: "engraving", title: "Flat contour engraving", description: "One Crater Lake contour SVG, with no layers to cut or glue.", size: "150 × 100 mm · one surface", guide: "/guides/topographic-map-engraving" },
  { id: "lake", title: "Surveyed lake relief", description: "Explore Crater Lake’s surveyed floor, then adjust the depth and stack to suit your material.", size: "200 × 150 mm · 3 mm sheets", guide: "/guides/custom-lake-depth-map" },
] as const;
export type StarterId = typeof STARTERS[number]["id"];
export function starterById(id: string | null): typeof STARTERS[number] | undefined {
  return STARTERS.find((starter) => starter.id === id);
}
