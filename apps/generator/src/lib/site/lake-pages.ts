import type { LakeDirectory, LakeDirectoryEntry, LakeDirectorySource } from "./lake-directory.ts";
import { LAKES_HOME, SITE_ORIGIN, socialCard, type SocialImage } from "./site.ts";
import type { PageSeo } from "./seo.ts";

/**
 * Prerendered lake-depth pages, generated from the lake directory at build
 * time. Each region gets one page; regions too large to list on one page are
 * split by county (Minnesota) or by initial letter, so no page lists more than
 * MAX_LAKES_PER_PAGE lakes. The lists are what search engines index, which the
 * client-side directory search cannot offer.
 *
 * This module is imported by load functions, endpoints and the Node
 * verification scripts; it must not reach the browser bundle of other pages.
 */
export { LAKES_HOME };
/** Last significant change of the page templates; the directory date also counts. */
const LAKE_PAGES_UPDATED = "2026-09-21";
const MAX_LAKES_PER_PAGE = 400;
/** Counties with fewer lakes are listed on the Minnesota page instead of a page of their own. */
const MIN_COUNTY_PAGE_LAKES = 8;

export interface RegionConfig {
  slug: string;
  name: string;
  sources: readonly string[];
  split?: "county" | "state" | "alphabet";
  about: string;
  /** Title and description wording where "<name> Lake Depth Maps" reads badly. */
  titleName?: string;
  description?: string;
}

/** One page per region. The sharing-card script reads these too, to draw each region's card. */
export const LAKE_REGIONS: readonly RegionConfig[] = [
  { slug: "minnesota", name: "Minnesota", sources: ["mn-dnr-lakes-v1"], split: "county", about: "Minnesota DNR publishes depth contours surveyed for thousands of the state’s lakes, from small kettle lakes to Mille Lacs and Lake Minnetonka. TopoStack interpolates between the surveyed contours to build a lake floor you can cut as layers." },
  { slug: "ontario", name: "Ontario", sources: ["ontario-lakes-v1"], split: "alphabet", about: "Ontario’s provincial bathymetry covers thousands of inland lakes, most of them in cottage country and the north. Depths come from survey contours that TopoStack interpolates within the surveyed area." },
  { slug: "finland", name: "Finland", sources: ["syke-finland-lakes-v1"], split: "alphabet", about: "Finland’s environment institute (Syke) publishes depth contours for lakes across the country. Some records carry only a map reference instead of a name; they are listed as published." },
  { slug: "norway", name: "Norway", sources: ["nve-norway-lakes-v1"], split: "alphabet", about: "The Norwegian Water Resources and Energy Directorate (NVE) publishes depth contours for hundreds of lakes, from lowland lakes to mountain reservoirs." },
  { slug: "switzerland", name: "Switzerland and border lakes", titleName: "Swiss Lake", description: "Surveyed lake-floor grids from swisstopo for Swiss and border lakes, including Lake Geneva, Lake Constance and Lake Neuchâtel. Make a layered wood lake map.", sources: ["swissbathy3d-v1"], about: "swisstopo’s swissBATHY3D is a high-resolution lake-floor model of the major Swiss lakes, including lakes shared with France, Germany, Austria and Italy. Coverage follows the published survey footprint." },
  { slug: "great-lakes", name: "Great Lakes", titleName: "Great Lakes", description: "NOAA surveyed depth grids for Lake Superior, Michigan, Huron, Erie, Ontario and Lake St. Clair. Make a layered wood Great Lakes map or an engraving.", sources: ["noaa-great-lakes-v1"], about: "NOAA’s Great Lakes bathymetry is a surveyed grid covering all five Great Lakes and Lake St. Clair, detailed enough for a whole-lake relief or a close-up of one bay." },
  { slug: "united-states", name: "United States lakes and reservoirs", titleName: "US Lake and Reservoir", split: "state", description: "Depth data for Crater Lake, Lake Tahoe, Lake Okeechobee, Lake Champlain, Lake Pontchartrain and hundreds more US lakes and reservoirs. Make a layered wood lake map or an engraving.", sources: ["usgs-crater-lake-v1", "usgs-lake-tahoe-v1", "usgs-mono-lake-v1", "twdb-texas-reservoirs-v1", "usbr-reservoirs-v1", "noaa-nbs-florida-v1", "noaa-nbs-gulf-coast-v1", "noaa-nbs-atlantic-coast-v1", "noaa-nbs-great-lakes-basin-v1", "noaa-nbs-california-v1", "noaa-nbs-northwest-coast-v1", "noaa-nbs-inland-northwest-v1", "noaa-nbs-alaska-v1", "noaa-nbs-caribbean-v1", "noaa-enc-florida-v1", "noaa-enc-gulf-coast-v1", "noaa-enc-atlantic-coast-v1", "noaa-enc-great-lakes-basin-v1", "noaa-enc-new-york-vermont-v1", "noaa-enc-california-v1", "noaa-enc-columbia-river-v1", "noaa-enc-alaska-v1"], about: "Multibeam surveys from USGS cover Crater Lake, Lake Tahoe and Mono Lake, and reservoir surveys from the Texas Water Development Board and the Bureau of Reclamation cover selected reservoirs. NOAA’s National Bathymetric Source adds measured depths for hundreds of lakes, lagoons and coastal ponds, from Lake Pontchartrain and the St. Johns River lakes to Lake Washington and Lake Pend Oreille; only the surveyed parts are used. NOAA nautical charts add Lake Okeechobee, Lake Champlain, the New York canal lakes and Michigan’s inland and harbour lakes from charted contours and soundings. Minnesota has its own page." },
];

export interface LakeListing {
  /** The directory id; never shown. */
  id: string;
  name: string;
  aliases?: string[];
  note?: string;
  /** County or region, shown when a page mixes several. */
  place?: string;
  bounds: [number, number, number, number];
  /** The lake's own page, for lakes that have one (lake-places.ts). */
  page?: string;
}
export interface LakePageLink { path: string; label: string; count: number }
export interface LakePage {
  path: string;
  title: string;
  description: string;
  label: string;
  heading: string;
  intro: string;
  about: string;
  updated: string;
  trail: { path: string; label: string }[];
  sources: Pick<LakeDirectorySource, "name" | "url" | "kind" | "license">[];
  lakes: LakeListing[];
  children: LakePageLink[];
  largest: LakeListing[];
  total: number;
}
export interface LakeRegionSummary { path: string; name: string; count: number; kind: string; sources: string[] }

const slugify = (text: string): string => text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/ø/g, "o").replace(/æ/g, "ae").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const kindText = (kinds: Set<string>): string => kinds.size > 1 ? "surveyed grids and survey contours" : kinds.has("grid") ? "surveyed depth grids" : "survey depth contours";
function footprint([west, south, east, north]: LakeDirectoryEntry["bounds"]): number {
  return (east - west) * Math.cos(((south + north) / 2) * Math.PI / 180) * (north - south);
}
function initial(name: string): string {
  const letter = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().charAt(0).toUpperCase().replace("Ø", "O").replace("Æ", "A");
  return /[A-Z]/.test(letter) ? letter : "#";
}
const byName = (a: LakeDirectoryEntry, b: LakeDirectoryEntry): number => a.name.localeCompare(b.name, "en") || a.id.localeCompare(b.id, "en");
/** The county part of a Minnesota region, with the survey's spelling variants ("St Louis", "St.Louis") left to the slug to merge. */
const countyOf = (lake: LakeDirectoryEntry): string => lake.region.split(" · ")[0]!.split(", ").at(-1)!;
/** The state part of a US region ("Monroe County · Florida, USA" or "Oregon, USA"); multi-state lakes keep their pair. */
const stateOf = (lake: LakeDirectoryEntry): string => lake.region.split(" · ").at(-1)!.replace(/, (USA|Canada)$/, "");
const plural = (count: number, word: string): string => `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;
function listFrom(names: string[]): string {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
function largest(lakes: LakeDirectoryEntry[], count: number): LakeDirectoryEntry[] {
  const names: string[] = [];
  const picked: LakeDirectoryEntry[] = [];
  for (const lake of lakes.toSorted((a, b) => footprint(b.bounds) - footprint(a.bounds))) {
    // Prefer plain names for summaries: skip map references, basin annotations,
    // place-named unnamed lakes, fragments of larger waters and the sub-basins of a lake already named.
    if (/\p{L}{3,}/u.test(lake.name) && !/[\d(]/.test(lake.name) && !/^(Unnamed|Part of) /.test(lake.name) && !names.some((name) => lake.name.startsWith(name))) { names.push(lake.name); picked.push(lake); }
    if (picked.length === count) break;
  }
  return picked;
}
const namesOf = (lakes: LakeDirectoryEntry[]): string[] => lakes.map((lake) => lake.name);
/** Notes repeat across large survey sets, so only short lists carry them. */
const NOTE_LIMIT = 40;
/** Lake id → slug of its own page; set for the duration of one buildLakePages call. */
let placeSlugs: ReadonlyMap<string, string> = new Map();
function listing(lake: LakeDirectoryEntry, place?: string, withNote = false): LakeListing {
  const aliases = lake.aliases?.filter((alias) => alias !== lake.name) ?? [];
  const slug = placeSlugs.get(lake.id);
  return { id: lake.id, name: lake.name, bounds: lake.bounds, ...(aliases.length ? { aliases } : {}), ...(withNote && lake.note ? { note: lake.note } : {}), ...(place ? { place } : {}), ...(slug ? { page: `/lake/${slug}` } : {}) };
}

/** Consecutive initials grouped so each group stays within the page limit. */
function alphabetGroups(lakes: LakeDirectoryEntry[]): { key: string; lakes: LakeDirectoryEntry[] }[] {
  const byInitial = new Map<string, LakeDirectoryEntry[]>();
  for (const lake of lakes) byInitial.set(initial(lake.name), [...(byInitial.get(initial(lake.name)) ?? []), lake]);
  // Records named by number stay on the region page itself.
  const initials = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter((letter) => byInitial.has(letter));
  const groups: { letters: string[]; lakes: LakeDirectoryEntry[] }[] = [];
  for (const letter of initials) {
    const current = groups.at(-1);
    const next = byInitial.get(letter)!;
    if (current && current.lakes.length + next.length <= MAX_LAKES_PER_PAGE) {
      current.letters.push(letter);
      current.lakes.push(...next);
    } else groups.push({ letters: [letter], lakes: [...next] });
  }
  return groups.map((group) => {
    const first = group.letters[0]!;
    const last = group.letters.at(-1)!;
    const key = first === last ? first : `${first}–${last}`;
    return { key, lakes: group.lakes };
  });
}

/**
 * @param slugs Lake id → slug for lakes with their own page, which the lists link to.
 * @returns The pages, the region summaries, and for each lake the breadcrumb trail of the list that names it.
 */
export function buildLakePages(directory: LakeDirectory, slugs: ReadonlyMap<string, string> = new Map()): { pages: Map<string, LakePage>; regions: LakeRegionSummary[]; trails: Map<string, LakePage["trail"]> } {
  placeSlugs = slugs;
  try { return buildPages(directory); } finally { placeSlugs = new Map(); }
}
function buildPages(directory: LakeDirectory): { pages: Map<string, LakePage>; regions: LakeRegionSummary[]; trails: Map<string, LakePage["trail"]> } {
  const sources = new Map(directory.sources.map((source) => [source.id, source]));
  const mapped = new Set(LAKE_REGIONS.flatMap((region) => region.sources));
  const unmapped = directory.sources.filter((source) => !mapped.has(source.id));
  if (unmapped.length) throw new Error(`Lake sources without a lake page: ${unmapped.map((source) => source.id).join(", ")}`);
  const updated = [LAKE_PAGES_UPDATED, directory.updated].sort().at(-1)!;
  const pages = new Map<string, LakePage>();
  const regions: LakeRegionSummary[] = [];
  const home = { path: LAKES_HOME, label: "Lake depth maps" };

  for (const region of LAKE_REGIONS) {
    const regionSources = region.sources.map((id) => sources.get(id)).filter((source): source is LakeDirectorySource => Boolean(source));
    const lakes = directory.lakes.filter((lake) => region.sources.includes(lake.sourceId)).sort(byName);
    if (!lakes.length) continue;
    const path = `${LAKES_HOME}/${region.slug}`;
    const kinds = new Set(regionSources.map((source) => source.kind));
    const sourceInfo = regionSources.map(({ name, url, kind, license }) => ({ name, url, kind, license }));
    const regionTrail = [home, { path, label: region.name }];
    const top = largest(lakes, 3);
    const children: LakePageLink[] = [];
    let listed = lakes;

    if (region.split === "county") {
      const counties = new Map<string, LakeDirectoryEntry[]>();
      for (const lake of lakes) counties.set(slugify(countyOf(lake)), [...(counties.get(slugify(countyOf(lake))) ?? []), lake]);
      listed = [];
      for (const [countySlug, countyLakes] of [...counties].sort(([a], [b]) => a.localeCompare(b, "en"))) {
        const spellings = new Map<string, number>();
        for (const lake of countyLakes) spellings.set(countyOf(lake), (spellings.get(countyOf(lake)) ?? 0) + 1);
        const county = [...spellings].sort(([, a], [, b]) => b - a)[0]![0];
        if (countyLakes.length < MIN_COUNTY_PAGE_LAKES) { listed.push(...countyLakes); continue; }
        const childPath = `${path}/${countySlug}`;
        const names = largest(countyLakes, 3);
        children.push({ path: childPath, label: county, count: countyLakes.length });
        pages.set(childPath, {
          path: childPath,
          title: `${county}, ${region.name} Lake Depth Maps | TopoStack`,
          description: `${plural(countyLakes.length, "lake")} in ${county}, ${region.name} with surveyed depth contours${names.length ? `, including ${listFrom(namesOf(names))}` : ""}. Turn any of them into a layered lake map.`,
          label: county,
          heading: `${county} lake depth maps`,
          intro: `${plural(countyLakes.length, "lake")} in ${county}, ${region.name}, have ${kindText(kinds)} in TopoStack. Open one in the studio to make a layered wooden lake map or a flat engraving.`,
          about: region.about,
          updated,
          trail: [...regionTrail, { path: childPath, label: county }],
          sources: sourceInfo,
          lakes: countyLakes.map((lake) => listing(lake, undefined, countyLakes.length <= NOTE_LIMIT)),
          children: [],
          largest: names.map((lake) => listing(lake)),
          total: countyLakes.length,
        });
      }
    } else if (region.split === "state") {
      const states = new Map<string, LakeDirectoryEntry[]>();
      for (const lake of lakes) states.set(stateOf(lake), [...(states.get(stateOf(lake)) ?? []), lake]);
      listed = [];
      for (const [state, stateLakes] of [...states].sort(([a], [b]) => a.localeCompare(b, "en"))) {
        if (stateLakes.length < MIN_COUNTY_PAGE_LAKES) { listed.push(...stateLakes); continue; }
        const childPath = `${path}/${slugify(state)}`;
        const names = largest(stateLakes, 3);
        const stateKinds = new Set(stateLakes.map((lake) => sources.get(lake.sourceId)?.kind ?? "grid"));
        children.push({ path: childPath, label: state, count: stateLakes.length });
        pages.set(childPath, {
          path: childPath,
          title: `${state} Lake Depth Maps | TopoStack`,
          description: `${plural(stateLakes.length, "lake")} in ${state} with ${kindText(stateKinds)}${names.length ? `, including ${listFrom(namesOf(names))}` : ""}. Turn any of them into a layered lake map.`,
          label: state,
          heading: `${state} lake depth maps`,
          intro: `${plural(stateLakes.length, "lake")} in ${state} have ${kindText(stateKinds)} in TopoStack. Open one in the studio to make a layered wooden lake map or a flat engraving.`,
          about: region.about,
          updated,
          trail: [...regionTrail, { path: childPath, label: state }],
          sources: sourceInfo.filter((_, index) => stateLakes.some((lake) => lake.sourceId === regionSources[index]!.id)),
          lakes: stateLakes.map((lake) => listing(lake, lake.region.includes(" · ") ? lake.region.split(" · ")[0] : undefined, stateLakes.length <= NOTE_LIMIT)),
          children: [],
          largest: names.map((lake) => listing(lake)),
          total: stateLakes.length,
        });
      }
    } else if (region.split === "alphabet" && lakes.length > MAX_LAKES_PER_PAGE) {
      listed = lakes.filter((lake) => initial(lake.name) === "#");
      for (const group of alphabetGroups(lakes)) {
        const childPath = `${path}/${slugify(group.key)}`;
        const names = largest(group.lakes, 3);
        const range = `lakes ${group.key}`;
        children.push({ path: childPath, label: `Lakes ${group.key}`, count: group.lakes.length });
        pages.set(childPath, {
          path: childPath,
          title: `${region.name} Lake Depth Maps: Lakes ${group.key} | TopoStack`,
          description: `${plural(group.lakes.length, "lake")} in ${region.name} (${range}) with ${kindText(kinds)}${names.length ? `, including ${listFrom(namesOf(names))}` : ""}. Open any of them in the studio.`,
          label: children.at(-1)!.label,
          heading: `${region.name} lake depth maps: ${range}`,
          intro: `${plural(group.lakes.length, "lake")} in ${region.name}, ${range}, with ${kindText(kinds)}. Open one in the studio to make a layered lake map or a flat engraving.`,
          about: region.about,
          updated,
          trail: [...regionTrail, { path: childPath, label: children.at(-1)!.label }],
          sources: sourceInfo,
          lakes: group.lakes.map((lake) => listing(lake)),
          children: [],
          largest: names.map((lake) => listing(lake)),
          total: group.lakes.length,
        });
      }
    }

    pages.set(path, {
      path,
      title: `${region.titleName ?? `${region.name} Lake`} Depth Maps for Laser Cutting | TopoStack`,
      description: region.description ?? `${plural(lakes.length, "lake")} in ${region.name} with ${kindText(kinds)}${top.length ? `, including ${listFrom(namesOf(top))}` : ""}. Make a layered wood lake map or an engraving.`,
      label: region.name,
      heading: `${region.name} lake depth maps`,
      intro: `${plural(lakes.length, "lake")} in ${region.name} have ${kindText(kinds)} in TopoStack. Pick a lake, open it in the studio, and export SVG layers for a laser-cut lake map.`,
      about: region.about,
      updated,
      trail: regionTrail,
      sources: sourceInfo,
      lakes: listed.map((lake) => listing(lake, region.split === "county" ? countyOf(lake) : region.sources.length > 1 ? lake.region : undefined, listed.length <= NOTE_LIMIT)),
      children,
      largest: top.map((lake) => listing(lake)),
      total: lakes.length,
    });
    regions.push({ path, name: region.name, count: lakes.length, kind: kindText(kinds), sources: regionSources.map((source) => source.name) });
  }
  // Each lake is listed on exactly one page: its county, state or letter page, or the region page itself.
  const trails = new Map<string, LakePage["trail"]>();
  for (const page of pages.values()) for (const lake of page.lakes) trails.set(lake.id, page.trail);
  return { pages, regions, trails };
}

/** A region's sharing card; its county, state and letter-range pages share it. */
export function lakeRegionCard(slug: string): SocialImage {
  const region = LAKE_REGIONS.find((entry) => entry.slug === slug);
  if (!region) throw new Error(`Unknown lake region: ${slug}`);
  return socialCard(`lakes-${slug}`, `${region.name} lake depth maps on TopoStack, with a map of the region's lakes that have depth data.`);
}

export function lakePageSeo(page: LakePage): PageSeo {
  const canonical = SITE_ORIGIN + page.path;
  // Generated pages sit under their region: /lakes/<region>[/<sub-page>].
  const region = page.path.slice(LAKES_HOME.length + 1).split("/")[0]!;
  return {
    title: page.title,
    description: page.description,
    canonical,
    registered: true,
    image: lakeRegionCard(region),
    breadcrumbs: [{ name: "TopoStack", item: SITE_ORIGIN + "/" }, ...page.trail.map((step) => ({ name: step.label, item: SITE_ORIGIN + step.path }))],
  };
}
