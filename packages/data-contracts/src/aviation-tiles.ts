/**
 * The FAA aviation PMTiles archive: layer names, per-feature properties, and
 * archive metadata. The offline builder writes exactly this shape and the
 * browser decodes it back through the same parsers, so an unknown value is
 * dropped at the boundary instead of reaching geometry.
 *
 * Boundaries (airspace, special use airspace, runway outlines) are stored as
 * LineStrings, never polygons: tile clipping then only splits lines, which the
 * browser rejoins, and never invents an edge along a tile seam.
 */

export const AVIATION_LAYERS = ["airspace", "sua", "runways", "airports", "navaids", "obstacles"] as const;
export type AviationLayer = (typeof AVIATION_LAYERS)[number];

export const AIRSPACE_CLASSES = ["B", "C", "D"] as const;
export type AirspaceClass = (typeof AIRSPACE_CLASSES)[number];

/** Special use airspace types as the FAA codes them, spelled out. */
export const SUA_KINDS = ["prohibited", "restricted", "warning", "alert", "moa", "danger"] as const;
export type SuaKind = (typeof SUA_KINDS)[number];

export const RUNWAY_ROLES = ["outline", "centerline"] as const;
export type RunwayRole = (typeof RUNWAY_ROLES)[number];

export const AIRPORT_KINDS = ["airport", "heliport", "seaplane-base", "other"] as const;
export type AirportKind = (typeof AIRPORT_KINDS)[number];

export const AIRPORT_USES = ["public", "private", "military"] as const;
export type AirportUse = (typeof AIRPORT_USES)[number];

export const NAVAID_KINDS = ["vor", "vortac", "vor-dme", "tacan", "ndb", "ndb-dme", "dme"] as const;
export type NavaidKind = (typeof NAVAID_KINDS)[number];

export interface AirspaceProperties { class: AirspaceClass; name: string; ident?: string; floorFt?: number; ceilingFt?: number }
export interface SuaProperties { kind: SuaKind; name: string }
export interface RunwayProperties { airport: string; runway: string; role: RunwayRole; widthFt: number; lengthFt: number }
export interface AirportProperties { ident: string; name: string; kind: AirportKind; use: AirportUse; towered: boolean; longestRunwayFt?: number }
export interface NavaidProperties { ident: string; name: string; kind: NavaidKind }
export interface ObstacleProperties { aglFt: number; lit: boolean }

export interface AviationPropertiesByLayer {
  airspace: AirspaceProperties;
  sua: SuaProperties;
  runways: RunwayProperties;
  airports: AirportProperties;
  navaids: NavaidProperties;
  obstacles: ObstacleProperties;
}

/** Geometry each layer carries in the archive (vector tile type 1 point, 2 line). */
export const AVIATION_LAYER_GEOMETRY: Record<AviationLayer, "point" | "line"> = {
  airspace: "line", sua: "line", runways: "line", airports: "point", navaids: "point", obstacles: "point",
};

// Tile properties are snake_case, as vector tile schemas conventionally are.
type Raw = Record<string, unknown>;

const text = (raw: Raw, key: string, max = 120): string | undefined => {
  const value = raw[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
};

const feet = (raw: Raw, key: string, max = 100_000): number | undefined => {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max ? Math.round(value) : undefined;
};

const member = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  typeof value === "string" && (values as readonly string[]).includes(value) ? value as T : undefined;

/** Strips undefined optionals so parsed objects compare and serialize cleanly. */
const compact = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;

function parseAirspace(raw: Raw): AirspaceProperties | undefined {
  const cls = member(AIRSPACE_CLASSES, raw.class);
  const name = text(raw, "name");
  if (!cls || !name) return undefined;
  return compact({ class: cls, name, ident: text(raw, "ident", 8), floorFt: feet(raw, "floor_ft"), ceilingFt: feet(raw, "ceiling_ft") });
}

function parseSua(raw: Raw): SuaProperties | undefined {
  const kind = member(SUA_KINDS, raw.kind);
  const name = text(raw, "name");
  return kind && name ? { kind, name } : undefined;
}

function parseRunway(raw: Raw): RunwayProperties | undefined {
  const airport = text(raw, "airport", 8);
  const runway = text(raw, "runway", 16);
  const role = member(RUNWAY_ROLES, raw.role);
  const widthFt = feet(raw, "width_ft", 2_000);
  const lengthFt = feet(raw, "length_ft", 30_000);
  if (!airport || !runway || !role || !widthFt || !lengthFt) return undefined;
  return { airport, runway, role, widthFt, lengthFt };
}

function parseAirport(raw: Raw): AirportProperties | undefined {
  const ident = text(raw, "ident", 8);
  const name = text(raw, "name");
  const kind = member(AIRPORT_KINDS, raw.kind);
  const use = member(AIRPORT_USES, raw.use);
  if (!ident || !name || !kind || !use || typeof raw.towered !== "boolean") return undefined;
  return compact({ ident, name, kind, use, towered: raw.towered, longestRunwayFt: feet(raw, "longest_runway_ft", 30_000) });
}

function parseNavaid(raw: Raw): NavaidProperties | undefined {
  const ident = text(raw, "ident", 8);
  const name = text(raw, "name");
  const kind = member(NAVAID_KINDS, raw.kind);
  return ident && name && kind ? { ident, name, kind } : undefined;
}

function parseObstacle(raw: Raw): ObstacleProperties | undefined {
  const aglFt = feet(raw, "agl_ft", 5_000);
  if (!aglFt || typeof raw.lit !== "boolean") return undefined;
  return { aglFt, lit: raw.lit };
}

const PARSERS: { [L in AviationLayer]: (raw: Raw) => AviationPropertiesByLayer[L] | undefined } = {
  airspace: parseAirspace, sua: parseSua, runways: parseRunway, airports: parseAirport, navaids: parseNavaid, obstacles: parseObstacle,
};

export function isAviationLayer(value: unknown): value is AviationLayer {
  return member(AVIATION_LAYERS, value) !== undefined;
}

/** Typed properties for one tile feature, or undefined when it does not satisfy the contract. */
export function parseAviationProperties<L extends AviationLayer>(layer: L, raw: unknown): AviationPropertiesByLayer[L] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return PARSERS[layer](raw as Raw);
}

/** The exact snake_case properties the builder writes for a feature. */
export function aviationTileProperties<L extends AviationLayer>(layer: L, value: AviationPropertiesByLayer[L]): Record<string, string | number | boolean> {
  const snake = (key: string) => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const properties = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [snake(key), entry as string | number | boolean]));
  if (!parseAviationProperties(layer, properties)) throw new Error(`Feature does not satisfy the ${layer} contract.`);
  return properties;
}

export interface AviationArchiveMetadata {
  /** Versioned archive identity, e.g. `faa-aviation-2026-09-03-v1`. */
  dataset: string;
  /** Effective date of the NASR cycle the airspace, airports, runways and navaids come from. */
  nasrCycle: string;
  /** Currency date of the Digital Obstacle File. */
  obstacleDate: string;
  /** Capture date of the special use airspace snapshot. */
  suaDate: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATASET = /^faa-aviation-\d{4}-\d{2}-\d{2}-v[1-9]\d*$/;

/**
 * PMTiles JSON metadata written by the builder. Keys are prefixed like the
 * other TopoStack archives (`topostack_dataset`).
 */
export function parseAviationArchiveMetadata(value: unknown): AviationArchiveMetadata {
  if (!value || typeof value !== "object") throw new Error("Aviation archive metadata is missing.");
  const raw = value as Raw;
  const date = (key: string): string => {
    const entry = raw[key];
    if (typeof entry !== "string" || !ISO_DATE.test(entry) || !Number.isFinite(Date.parse(entry))) throw new Error(`Aviation archive metadata requires ${key}.`);
    return entry;
  };
  const dataset = raw.topostack_dataset;
  if (typeof dataset !== "string" || !DATASET.test(dataset)) throw new Error("Aviation archive has an invalid dataset identity.");
  const nasrCycle = date("faa_nasr_cycle");
  if (!dataset.startsWith(`faa-aviation-${nasrCycle}-`)) throw new Error("Aviation archive dataset does not match its NASR cycle.");
  return { dataset, nasrCycle, obstacleDate: date("faa_obstacle_date"), suaDate: date("faa_sua_date") };
}

export function aviationArchiveMetadata(value: AviationArchiveMetadata): Record<string, string> {
  const metadata = { topostack_dataset: value.dataset, faa_nasr_cycle: value.nasrCycle, faa_obstacle_date: value.obstacleDate, faa_sua_date: value.suaDate };
  parseAviationArchiveMetadata(metadata);
  return metadata;
}

export interface AviationCoverageRegion { id: string; bounds: [number, number, number, number] }

/** The pinned build registration in `scripts/data/faa-aviation-sources.json`. */
export interface AviationSources extends AviationArchiveMetadata {
  name: string;
  url: string;
  license: string;
  maxZoom: number;
  /** Where the FAA publishes this data; a crop outside every box is not covered. */
  coverage: AviationCoverageRegion[];
}

export function validateAviationSources(value: unknown): AviationSources {
  if (!value || typeof value !== "object") throw new Error("Aviation sources must be an object.");
  const raw = value as Raw;
  const metadata = parseAviationArchiveMetadata({ topostack_dataset: raw.dataset, faa_nasr_cycle: raw.nasrCycle, faa_obstacle_date: raw.obstacleDate, faa_sua_date: raw.suaDate });
  const required = (key: string): string => {
    const entry = text(raw, key, 400);
    if (!entry) throw new Error(`Aviation sources require ${key}.`);
    return entry;
  };
  const url = required("url");
  if (new URL(url).protocol !== "https:") throw new Error("Aviation source URL must use https.");
  const maxZoom = raw.maxZoom;
  if (typeof maxZoom !== "number" || !Number.isInteger(maxZoom) || maxZoom < 1 || maxZoom > 15) throw new Error("Invalid aviation maxZoom.");
  if (!Array.isArray(raw.coverage) || !raw.coverage.length) throw new Error("Aviation sources require coverage regions.");
  const ids = new Set<string>();
  const coverage = raw.coverage.map((item: unknown): AviationCoverageRegion => {
    const region = (item && typeof item === "object" ? item : {}) as Raw;
    const id = text(region, "id", 64);
    const bounds = region.bounds;
    if (!id || ids.has(id) || !Array.isArray(bounds) || bounds.length !== 4 || !bounds.every((n) => typeof n === "number" && Number.isFinite(n))) throw new Error("Invalid aviation coverage region.");
    const [west, south, east, north] = bounds as [number, number, number, number];
    if (west < -180 || east > 180 || south < -85.0511 || north > 85.0511 || west >= east || south >= north) throw new Error(`Invalid aviation coverage bounds: ${id}`);
    ids.add(id);
    return { id, bounds: [west, south, east, north] };
  });
  return { ...metadata, name: required("name"), url, license: required("license"), maxZoom, coverage };
}

/** True when a crop (west, south, east, north) touches published FAA coverage. */
export function aviationCovers(sources: Pick<AviationSources, "coverage">, bounds: { west: number; south: number; east: number; north: number }): boolean {
  return sources.coverage.some(({ bounds: [west, south, east, north] }) => bounds.west < east && bounds.east > west && bounds.south < north && bounds.north > south);
}
