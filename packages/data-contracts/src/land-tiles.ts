import { isMercatorBoundsTuple } from "./geo-bounds.ts";

/**
 * The public lands PMTiles archive: one `lands` layer of polygons, one record
 * per unit (a national park, a wilderness, a state's BLM land), with the class
 * that picks its paint stencil. The offline builder writes exactly this shape
 * from PAD-US and the browser decodes it back through the same parser, so an
 * unknown class is dropped at the boundary instead of reaching geometry.
 *
 * A unit is cut by tile seams like any polygon; the browser unions a unit's
 * pieces by `unit`. Units of different classes overlap (a wilderness inside a
 * national forest); the studio decides which paints where, not the archive.
 *
 * Units come from USGS PAD-US (the United States) and, from the second
 * release, from Canada's CPCAD; each Canadian unit says so in `source`, so the
 * studio credits the source a model actually used.
 */

export const LANDS_LAYER = "lands";

/** Every class a land feature can carry; each is one paint stencil. */
export const LAND_CLASSES = [
  "national-park", "national-monument", "national-forest", "wilderness", "blm",
  "wildlife-refuge", "state-park", "preserve", "tribal", "military",
] as const;
export type LandClass = (typeof LAND_CLASSES)[number];

export const LAND_SOURCES = ["padus", "cpcad"] as const;
export type LandSource = (typeof LAND_SOURCES)[number];

export interface LandProperties {
  class: LandClass;
  /** Unique within the archive; joins one unit's tile pieces. */
  unit: string;
  /** Absent where the source names nothing worth printing (BLM land, unnamed preserves). */
  name?: string;
  /** The managing agency's PAD-US code, such as `NPS` or `BLM`. */
  manager?: string;
  /** Area of the whole unit, for ranking labels. */
  acres: number;
  /** Where the outline comes from; absent means PAD-US, as in every first-release archive. */
  source?: LandSource;
}

type Raw = Record<string, unknown>;

const text = (raw: Raw, key: string, max: number): string | undefined => {
  const value = raw[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

const member = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  typeof value === "string" && (values as readonly string[]).includes(value) ? value as T : undefined;

/** Largest unit area accepted: a little over Alaska. */
const MAX_ACRES = 500_000_000;

export function isLandClass(value: unknown): value is LandClass {
  return member(LAND_CLASSES, value) !== undefined;
}

/** Typed properties for one tile feature, or undefined when it does not satisfy the contract. */
export function parseLandProperties(raw: unknown): LandProperties | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Raw;
  const cls = member(LAND_CLASSES, record.class);
  const unit = text(record, "unit", 200);
  const acres = record.acres;
  if (!cls || !unit || typeof acres !== "number" || !Number.isInteger(acres) || acres < 0 || acres > MAX_ACRES) return undefined;
  const name = text(record, "name", 160);
  const manager = text(record, "manager", 8);
  const source = member(LAND_SOURCES, record.source);
  return { class: cls, unit, ...(name ? { name } : {}), ...(manager ? { manager } : {}), acres, ...(source && source !== "padus" ? { source } : {}) };
}

/** The exact properties the builder writes for a feature; throws when the value would not parse back whole. */
export function landTileProperties(value: LandProperties): Record<string, string | number> {
  const properties = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Record<string, string | number>;
  const parsed = parseLandProperties(properties);
  if (!parsed || Object.keys(parsed).length !== Object.keys(properties).length) throw new Error("Feature does not satisfy the lands contract.");
  return properties;
}

export interface LandsArchiveMetadata {
  /** Versioned archive identity, e.g. `public-lands-2025-03-31-v1`, dated by the PAD-US release. */
  dataset: string;
  /** PAD-US version, e.g. `4.1`. */
  padusVersion: string;
  /** PAD-US publication date. */
  padusDate: string;
  /** CPCAD release date, when the archive holds Canadian units. */
  cpcadDate?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATASET = /^public-lands-\d{4}-\d{2}-\d{2}-v[1-9]\d*$/;
const VERSION = /^\d+\.\d+$/;

/** PMTiles JSON metadata written by the builder, prefixed like the other TopoStack archives. */
export function parseLandsArchiveMetadata(value: unknown): LandsArchiveMetadata {
  if (!value || typeof value !== "object") throw new Error("Lands archive metadata is missing.");
  const raw = value as Raw;
  const dataset = raw.topostack_dataset;
  if (typeof dataset !== "string" || !DATASET.test(dataset)) throw new Error("Lands archive has an invalid dataset identity.");
  const padusVersion = raw.padus_version;
  if (typeof padusVersion !== "string" || !VERSION.test(padusVersion)) throw new Error("Lands archive metadata requires padus_version.");
  const padusDate = raw.padus_date;
  if (typeof padusDate !== "string" || !ISO_DATE.test(padusDate) || !Number.isFinite(Date.parse(padusDate))) throw new Error("Lands archive metadata requires padus_date.");
  if (!dataset.startsWith(`public-lands-${padusDate}-`)) throw new Error("Lands archive dataset does not match its PAD-US date.");
  const cpcadDate = raw.cpcad_date;
  if (cpcadDate !== undefined && (typeof cpcadDate !== "string" || !ISO_DATE.test(cpcadDate) || !Number.isFinite(Date.parse(cpcadDate)))) throw new Error("Lands archive metadata has an invalid cpcad_date.");
  return { dataset, padusVersion, padusDate, ...(cpcadDate ? { cpcadDate } : {}) };
}

export function landsArchiveMetadata(value: LandsArchiveMetadata): Record<string, string> {
  const metadata = { topostack_dataset: value.dataset, padus_version: value.padusVersion, padus_date: value.padusDate, ...(value.cpcadDate ? { cpcad_date: value.cpcadDate } : {}) };
  parseLandsArchiveMetadata(metadata);
  return metadata;
}

export interface LandsCoverageRegion {
  id: string;
  bounds: [number, number, number, number];
  /** The source with units there; absent means PAD-US. */
  source?: LandSource;
}

/** The second source's registration: Canada's Protected and Conserved Areas Database. */
export interface LandsCanadaSource {
  name: string;
  url: string;
  license: string;
  date: string;
}

/** The pinned build registration in `scripts/data/public-lands-sources.json`. */
export interface LandsSources extends LandsArchiveMetadata {
  name: string;
  url: string;
  license: string;
  minZoom: number;
  maxZoom: number;
  /**
   * A wildlife refuge's approved boundary is painted whole when the Fish and
   * Wildlife Service owns at least this share of it, or none of it (an
   * overlay refuge on another agency's land); otherwise only the land it owns
   * inside. Some approved boundaries are drawn around whole regions the agency
   * may one day buy into.
   */
  refugeOwnedShare: number;
  /** Where the archive has data; a crop outside every box is not covered. */
  coverage: LandsCoverageRegion[];
  /** Present when the archive also holds CPCAD units; its date is the archive's `cpcad_date`. */
  canada?: LandsCanadaSource;
}

export function validateLandsSources(value: unknown): LandsSources {
  if (!value || typeof value !== "object") throw new Error("Lands sources must be an object.");
  const raw = value as Raw;
  const canadaRaw = raw.canada === undefined ? undefined : (raw.canada && typeof raw.canada === "object" ? raw.canada as Raw : {});
  const metadata = parseLandsArchiveMetadata({ topostack_dataset: raw.dataset, padus_version: raw.padusVersion, padus_date: raw.padusDate, ...(canadaRaw ? { cpcad_date: canadaRaw.date } : {}) });
  const required = (key: string): string => {
    const entry = text(raw, key, 400);
    if (!entry) throw new Error(`Lands sources require ${key}.`);
    return entry;
  };
  const url = required("url");
  if (new URL(url).protocol !== "https:") throw new Error("Lands source URL must use https.");
  const zoom = (key: string): number => {
    const entry = raw[key];
    if (typeof entry !== "number" || !Number.isInteger(entry) || entry < 0 || entry > 15) throw new Error(`Invalid lands ${key}.`);
    return entry;
  };
  const minZoom = zoom("minZoom");
  const maxZoom = zoom("maxZoom");
  if (minZoom > maxZoom) throw new Error("Lands minZoom exceeds maxZoom.");
  const refugeOwnedShare = raw.refugeOwnedShare;
  if (typeof refugeOwnedShare !== "number" || !(refugeOwnedShare > 0 && refugeOwnedShare <= 1)) throw new Error("Invalid lands refugeOwnedShare.");
  if (!Array.isArray(raw.coverage) || !raw.coverage.length) throw new Error("Lands sources require coverage regions.");
  const ids = new Set<string>();
  const coverage = raw.coverage.map((item: unknown): LandsCoverageRegion => {
    const region = (item && typeof item === "object" ? item : {}) as Raw;
    const id = text(region, "id", 64);
    const bounds = region.bounds;
    const source = region.source === undefined ? undefined : member(LAND_SOURCES, region.source);
    if (!id || ids.has(id) || !isMercatorBoundsTuple(bounds) || (region.source !== undefined && !source) || (source === "cpcad" && !canadaRaw)) throw new Error(`Invalid lands coverage region: ${id ?? "unnamed"}`);
    ids.add(id);
    return { id, bounds: [...bounds], ...(source && source !== "padus" ? { source } : {}) };
  });
  let canada: LandsCanadaSource | undefined;
  if (canadaRaw) {
    const field = (key: string): string => {
      const entry = text(canadaRaw, key, 400);
      if (!entry) throw new Error(`Lands sources require canada.${key}.`);
      return entry;
    };
    canada = { name: field("name"), url: field("url"), license: field("license"), date: metadata.cpcadDate! };
    if (new URL(canada.url).protocol !== "https:") throw new Error("Lands Canada source URL must use https.");
  }
  return { ...metadata, name: required("name"), url, license: required("license"), minZoom, maxZoom, refugeOwnedShare, coverage, ...(canada ? { canada } : {}) };
}

/** True when a crop (west, south, east, north) touches the archive's coverage. */
export function landsCovers(sources: Pick<LandsSources, "coverage">, bounds: { west: number; south: number; east: number; north: number }): boolean {
  return landSourcesCovering(sources, bounds).length > 0;
}

/** The sources whose coverage a crop touches, PAD-US first. */
export function landSourcesCovering(sources: Pick<LandsSources, "coverage">, bounds: { west: number; south: number; east: number; north: number }): LandSource[] {
  const touched = new Set(sources.coverage
    .filter(({ bounds: [west, south, east, north] }) => bounds.west < east && bounds.east > west && bounds.south < north && bounds.north > south)
    .map((region) => region.source ?? "padus"));
  return LAND_SOURCES.filter((source) => touched.has(source));
}
