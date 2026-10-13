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
 */

export const LANDS_LAYER = "lands";

/** Every class a land feature can carry; each is one paint stencil. */
export const LAND_CLASSES = [
  "national-park", "national-monument", "national-forest", "wilderness", "blm",
  "wildlife-refuge", "state-park", "preserve", "tribal", "military",
] as const;
export type LandClass = (typeof LAND_CLASSES)[number];

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
  return { class: cls, unit, ...(name ? { name } : {}), ...(manager ? { manager } : {}), acres };
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
  return { dataset, padusVersion, padusDate };
}

export function landsArchiveMetadata(value: LandsArchiveMetadata): Record<string, string> {
  const metadata = { topostack_dataset: value.dataset, padus_version: value.padusVersion, padus_date: value.padusDate };
  parseLandsArchiveMetadata(metadata);
  return metadata;
}

export interface LandsCoverageRegion { id: string; bounds: [number, number, number, number] }

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
  /** Where PAD-US has data; a crop outside every box is not covered. */
  coverage: LandsCoverageRegion[];
}

export function validateLandsSources(value: unknown): LandsSources {
  if (!value || typeof value !== "object") throw new Error("Lands sources must be an object.");
  const raw = value as Raw;
  const metadata = parseLandsArchiveMetadata({ topostack_dataset: raw.dataset, padus_version: raw.padusVersion, padus_date: raw.padusDate });
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
    if (!id || ids.has(id) || !isMercatorBoundsTuple(bounds)) throw new Error(`Invalid lands coverage region: ${id ?? "unnamed"}`);
    ids.add(id);
    return { id, bounds: [...bounds] };
  });
  return { ...metadata, name: required("name"), url, license: required("license"), minZoom, maxZoom, refugeOwnedShare, coverage };
}

/** True when a crop (west, south, east, north) touches PAD-US coverage. */
export function landsCovers(sources: Pick<LandsSources, "coverage">, bounds: { west: number; south: number; east: number; north: number }): boolean {
  return sources.coverage.some(({ bounds: [west, south, east, north] }) => bounds.west < east && bounds.east > west && bounds.south < north && bounds.north > south);
}
