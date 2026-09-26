import { lakeStudioLink, type LakeDirectory, type LakeDirectoryEntry, type LakeDirectorySource } from "./lake-directory.ts";
import { SITE_ORIGIN, type SocialImage } from "./site.ts";
import type { PageSeo } from "./seo.ts";

/**
 * One prerendered page per substantial named lake, at /lake/<slug>. The region
 * lists in lake-pages.ts link each lake's name here.
 *
 * Slugs are locked in lake-slugs.json, keyed by the source without its version
 * suffix plus the survey id. A lake keeps its URL when the data is rebuilt or a
 * source moves to a new version. A new lake can never take a slug that an
 * existing lake already has.
 * `node scripts/build/lock-lake-slugs.mjs` appends new lakes after a data
 * release, and lake-places.test.ts fails until it has been run.
 *
 * Like lake-pages.ts, this module is imported by load functions and Node
 * scripts only; it must not reach the browser bundle.
 */
export const LAKE_PLACE_HOME = "/lake";
/** Last significant change of the page template; the directory date also counts. */
const LAKE_PLACES_UPDATED = "2026-09-25";
/**
 * The survey area a contour-only lake needs before it gets a page of its own. Smaller lakes stay
 * on their region's list, which keeps the generated pages from being thin near-duplicates. Lower
 * it only once Search Console shows the lakes sitemap being indexed well.
 */
export const PLACE_PAGE_MIN_KM2 = 5;
const NEARBY_COUNT = 6;
/** Piece widths the planning table works out, in millimetres (12, 16 and 24 inches). */
const PIECE_WIDTHS_MM = [304.8, 406.4, 609.6] as const;

export type LakeSlugLock = Record<string, string>;
export interface LakeTrailStep { path: string; label: string }
export interface NearbyLake { name: string; href: string; distanceKm: number; hasPage: boolean }
export interface PiecePlan { widthMm: number; heightMm: number; scale: number }
export interface LakePlace {
  path: string;
  id: string;
  name: string;
  aliases: string[];
  note?: string;
  /** The county, state, province or country, as a label ("Cook County, Minnesota"). */
  place: string;
  heading: string;
  title: string;
  description: string;
  intro: string;
  updated: string;
  bounds: LakeDirectoryEntry["bounds"];
  center: { lat: number; lon: number };
  extentKm: { width: number; height: number };
  kind: LakeDirectorySource["kind"];
  source: Pick<LakeDirectorySource, "name" | "url" | "license">;
  studioPath: string;
  trail: LakeTrailStep[];
  plans: PiecePlan[];
  nearby: NearbyLake[];
}

export const slugify = (text: string): string => text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/ø/g, "o").replace(/æ/g, "ae").replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/** Stable across data rebuilds and source version bumps. */
export const placeKey = (lake: Pick<LakeDirectoryEntry, "sourceId" | "surveyId">): string => `${lake.sourceId.replace(/-v\d+$/, "")}:${lake.surveyId}`;

const KM_PER_DEGREE_LAT = 110.574;
const kmPerDegreeLon = (lat: number): number => 111.32 * Math.cos(lat * Math.PI / 180);
export function surveyExtentKm([west, south, east, north]: LakeDirectoryEntry["bounds"]): { width: number; height: number } {
  return { width: (east - west) * kmPerDegreeLon((south + north) / 2), height: (north - south) * KM_PER_DEGREE_LAT };
}
const centerOf = ([west, south, east, north]: LakeDirectoryEntry["bounds"]) => ({ lat: (south + north) / 2, lon: (west + east) / 2 });
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const toRad = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * toRad / 2) ** 2 + Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin((b.lon - a.lon) * toRad / 2) ** 2;
  return 12_742 * Math.asin(Math.sqrt(h));
}

/**
 * A published name, not a map reference, a fragment of another water, or a
 * Finnish record tagged with its N60 height-datum level ("Suontee (N60 94.10)").
 */
export function hasPlaceName(name: string): boolean {
  return /\p{L}{3,}/u.test(name) && !/\d{4,}/.test(name) && !/^(Unnamed|Part of) /.test(name) && !/\bN60\b/.test(name);
}
export function eligibleForPlacePage(lake: LakeDirectoryEntry, source: Pick<LakeDirectorySource, "kind">): boolean {
  if (!hasPlaceName(lake.name)) return false;
  const { width, height } = surveyExtentKm(lake.bounds);
  return source.kind === "grid" || width * height >= PLACE_PAGE_MIN_KM2;
}
/** "Cook County · Minnesota, USA" → "Cook County, Minnesota"; "Ontario, Canada" → "Ontario". */
export function placeLabel(region: string): string {
  return region.replace(/ & border lakes$/, "").replace(/, (USA|Canada)$/, "").replace(" · ", ", ");
}
/** Names that already say what kind of water they are ("Lake Tahoe", "Rutajärvi", "Bodensee"). */
const WATER_WORD = /\b(lakes?|lac|lago|laguna|loch|lough|ponds?|reservoir|lagoon|bay|sound|harbou?r|river|creek|bayou|basin|pool|flowage|inlet|slough|see|sjø|sjøen|vatn|vatnet|vann|vannet|järvi|jarvi|lampi|fjord|étang|etang|mere)\b|(järvi|jarvi|vatn|vatnet|vannet|sjøen|see|lampi|selkä)$/iu;
const lakeWord = (name: string): string => WATER_WORD.test(name) ? "" : " lake";

export function proposeSlug(lake: LakeDirectoryEntry): string {
  return slugify(`${lake.name} ${placeLabel(lake.region)}`);
}

/**
 * The lock with every eligible lake added. Existing entries never change. New
 * lakes that would share a slug, with each other or with a locked lake, all
 * get their survey id appended, so none of them depends on another's order.
 */
export function lockLakeSlugs(directory: LakeDirectory, lock: LakeSlugLock): LakeSlugLock {
  const sources = new Map(directory.sources.map((source) => [source.id, source]));
  const used = new Set(Object.values(lock));
  const fresh = new Map<string, LakeDirectoryEntry[]>();
  for (const lake of directory.lakes) {
    if (placeKey(lake) in lock || !eligibleForPlacePage(lake, sources.get(lake.sourceId)!)) continue;
    const slug = proposeSlug(lake);
    fresh.set(slug, [...(fresh.get(slug) ?? []), lake]);
  }
  const next: LakeSlugLock = { ...lock };
  for (const [slug, lakes] of [...fresh].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    for (const lake of lakes) {
      let chosen = lakes.length > 1 || used.has(slug) ? `${slug}-${slugify(lake.surveyId)}` : slug;
      while (used.has(chosen)) chosen += "-x";
      used.add(chosen);
      next[placeKey(lake)] = chosen;
    }
  }
  return Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b, "en")));
}

/** Lake id → slug for every eligible lake the lock names. Lakes missing from the lock get no page until it is updated. */
export function lakePlaceSlugs(directory: LakeDirectory, lock: LakeSlugLock): Map<string, string> {
  const sources = new Map(directory.sources.map((source) => [source.id, source]));
  const slugs = new Map<string, string>();
  for (const lake of directory.lakes) {
    const slug = lock[placeKey(lake)];
    if (slug && eligibleForPlacePage(lake, sources.get(lake.sourceId)!)) slugs.set(lake.id, slug);
  }
  return slugs;
}
export const lakePlacePath = (slug: string): string => `${LAKE_PLACE_HOME}/${slug}`;

const formatKm = (km: number): string => km >= 10 ? km.toFixed(0) : km >= 1 ? km.toFixed(1) : km.toFixed(2);
function coordinateText({ lat, lon }: { lat: number; lon: number }): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"}, ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;
}
/** A readable map scale: two significant figures (1:48,000 rather than 1:47,613). */
function roundScale(scale: number): number {
  const magnitude = 10 ** Math.max(0, Math.floor(Math.log10(scale)) - 1);
  return Math.round(scale / magnitude) * magnitude;
}
export function piecePlans(extent: { width: number; height: number }): PiecePlan[] {
  const landscape = extent.width >= extent.height;
  return PIECE_WIDTHS_MM.map((longMm) => {
    const longKm = landscape ? extent.width : extent.height;
    const shortMm = longMm * (landscape ? extent.height / extent.width : extent.width / extent.height);
    return { widthMm: landscape ? longMm : shortMm, heightMm: landscape ? shortMm : longMm, scale: roundScale(longKm * 1_000_000 / longMm) };
  });
}

function describe(lake: LakeDirectoryEntry, place: string, kind: LakeDirectorySource["kind"], extent: { width: number; height: number }, center: { lat: number; lon: number }): string {
  const data = kind === "grid" ? "a surveyed depth grid" : "survey depth contours";
  const size = `${formatKm(extent.width)} × ${formatKm(extent.height)} km`;
  const full = `${lake.name} in ${place} has ${data} in TopoStack, a ${size} survey area at ${coordinateText(center)}. Make a layered laser-cut lake map or an engraving.`;
  if (full.length <= 200) return full;
  const short = `${lake.name}, ${place}: ${data}, ${size}, at ${coordinateText(center)}. Make a laser-cut lake map or engraving.`;
  return short.length <= 200 ? short : `${lake.name}: ${data}, ${size}. Make a laser-cut lake map or an engraving in TopoStack.`;
}

type Located = { lake: LakeDirectoryEntry; center: { lat: number; lon: number } };
/** The closest named lakes, by a linear scan that keeps only the best few (the directory has thousands). */
function nearest(candidates: Located[], id: string, center: { lat: number; lon: number }): { other: Located; distance: number }[] {
  const best: { other: Located; distance: number }[] = [];
  for (const other of candidates) {
    if (other.lake.id === id) continue;
    const distance = distanceKm(center, other.center);
    if (best.length === NEARBY_COUNT && distance >= best.at(-1)!.distance) continue;
    const at = best.findIndex((entry) => distance < entry.distance);
    best.splice(at < 0 ? best.length : at, 0, { other, distance });
    if (best.length > NEARBY_COUNT) best.pop();
  }
  return best;
}

/**
 * @param trails The breadcrumb trail of the region list that names each lake (lake id → trail).
 */
export function buildLakePlaces(directory: LakeDirectory, slugs: Map<string, string>, trails: Map<string, LakeTrailStep[]>): Map<string, LakePlace> {
  const sources = new Map(directory.sources.map((source) => [source.id, source]));
  const updated = [LAKE_PLACES_UPDATED, directory.updated].sort().at(-1)!;
  const located = directory.lakes.map((lake) => ({ lake, center: centerOf(lake.bounds) }));
  const named = located.filter(({ lake }) => hasPlaceName(lake.name));
  const places = new Map<string, LakePlace>();
  for (const { lake, center } of located) {
    const slug = slugs.get(lake.id);
    if (!slug) continue;
    const source = sources.get(lake.sourceId)!;
    const place = placeLabel(lake.region);
    const extent = surveyExtentKm(lake.bounds);
    const path = lakePlacePath(slug);
    const word = lakeWord(lake.name);
    const nearby = nearest(named, lake.id, center)
      .map(({ other, distance }) => {
        const otherSlug = slugs.get(other.lake.id);
        return { name: other.lake.name, href: otherSlug ? lakePlacePath(otherSlug) : lakeStudioLink("", other.lake), distanceKm: Math.round(distance * 10) / 10, hasPage: Boolean(otherSlug) };
      });
    const aliases = lake.aliases?.filter((alias) => alias !== lake.name) ?? [];
    places.set(path, {
      path,
      id: lake.id,
      name: lake.name,
      aliases,
      ...(lake.note ? { note: lake.note } : {}),
      place,
      heading: `${lake.name}${word} depth map`,
      title: `${lake.name}${word ? " Lake" : ""} Depth Map, ${place} | TopoStack`,
      description: describe(lake, place, source.kind, extent, center),
      intro: `${lake.name}${aliases.length ? ` (also ${aliases.join(", ")})` : ""} in ${place} has ${source.kind === "grid" ? "a surveyed depth grid" : "survey depth contours"} from ${source.name}. Open it in the studio to make a layered laser-cut lake map or a flat engraving of its shoreline and lake floor.`,
      updated,
      bounds: lake.bounds,
      center,
      extentKm: extent,
      kind: source.kind,
      source: { name: source.name, url: source.url, license: source.license },
      studioPath: lakeStudioLink("", lake),
      trail: [...(trails.get(lake.id) ?? []), { path, label: lake.name }],
      plans: piecePlans(extent),
      nearby,
    });
  }
  // Two lakes with one name in one county: their coordinates tell the titles apart.
  const titles = new Map<string, number>();
  for (const page of places.values()) titles.set(page.title, (titles.get(page.title) ?? 0) + 1);
  for (const page of places.values()) {
    if (titles.get(page.title)! > 1) page.title = page.title.replace(" | TopoStack", ` (${coordinateText(page.center)}) | TopoStack`);
  }
  return places;
}

export function lakePlaceSeo(page: LakePlace, image: SocialImage): PageSeo {
  const [west, south, east, north] = page.bounds;
  return {
    title: page.title,
    description: page.description,
    canonical: SITE_ORIGIN + page.path,
    registered: true,
    image,
    breadcrumbs: [{ name: "TopoStack", item: SITE_ORIGIN + "/" }, ...page.trail.map((step) => ({ name: step.label, item: SITE_ORIGIN + step.path }))],
    place: {
      name: page.name,
      ...(page.aliases.length ? { alternateName: page.aliases } : {}),
      box: `${south.toFixed(5)} ${west.toFixed(5)} ${north.toFixed(5)} ${east.toFixed(5)}`,
      containedIn: page.place,
    },
  };
}
