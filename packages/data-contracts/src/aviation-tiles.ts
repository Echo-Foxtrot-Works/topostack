import { isMercatorBoundsTuple } from "./geo-bounds.ts";

/**
 * The FAA aviation PMTiles archive: layer names, per-feature properties, and
 * archive metadata. The offline builder writes exactly this shape and the
 * browser decodes it back through the same parsers, so an unknown value is
 * dropped at the boundary instead of reaching geometry.
 *
 * Boundaries (airspace, special use airspace) are stored as LineStrings, never
 * polygons: tile clipping then only splits lines, which the browser rejoins,
 * and never invents an edge along a tile seam. Every special use ring runs with
 * its area on the left, so a boundary's inside survives clipping; a Class B, C
 * or D edge two areas share is stored once. Each of those areas also has
 * candidate points for its altitude label (`airspace_labels`), each with the
 * room around it, so the model prints the label only where it fits inside the
 * area. Runways are centerlines with their width; the model draws the outline
 * when it is wide enough to read.
 *
 * Airspace is also stored as volumes (`airspace_volumes`, `sua_volumes`): one
 * polygon per sector with its floor and ceiling as charted, for models that
 * build airspace in three dimensions. A sector is cut by tile seams like any
 * polygon; the browser unions a sector's pieces by its `sector` number. Special
 * use sectors are not dissolved: the records of one area keep their own floors
 * and ceilings, exclusion pockets included.
 *
 * Airport and obstacle properties carry what the sectional legend draws from:
 * fuel (ticks), rotating beacon (star), hard surface and runway layout (filled
 * or patterned symbols), high-intensity lights, wind turbines and groups. They
 * are optional, so an archive written before them still parses.
 */

export const AVIATION_LAYERS = ["airspace", "airspace_labels", "sua", "runways", "airports", "navaids", "obstacles", "airspace_volumes", "sua_volumes"] as const;
export type AviationLayer = (typeof AVIATION_LAYERS)[number];

export const AIRSPACE_CLASSES = ["B", "C", "D"] as const;
export type AirspaceClass = (typeof AIRSPACE_CLASSES)[number];

/** Special use airspace types as the FAA codes them, spelled out. */
export const SUA_KINDS = ["prohibited", "restricted", "warning", "alert", "moa", "danger"] as const;
export type SuaKind = (typeof SUA_KINDS)[number];

export const AIRPORT_KINDS = ["airport", "heliport", "seaplane-base", "other"] as const;
export type AirportKind = (typeof AIRPORT_KINDS)[number];

export const AIRPORT_USES = ["public", "private", "military"] as const;
export type AirportUse = (typeof AIRPORT_USES)[number];

export const NAVAID_KINDS = ["vor", "vortac", "vor-dme", "tacan", "ndb", "ndb-dme", "dme"] as const;
export type NavaidKind = (typeof NAVAID_KINDS)[number];

/** Floor and ceiling were written on boundaries before the labels layer; an edge shared by two areas has neither now. */
export interface AirspaceProperties { class: AirspaceClass; name: string; ident?: string; floorFt?: number; ceilingFt?: number }
/** One place an area's altitudes may be printed. */
export interface AirspaceLabelProperties {
  class: AirspaceClass;
  /** Candidates with the same number belong to one area, which prints one label. */
  area: number;
  ceilingFt: number;
  /** Absent for Class D, which prints its ceiling alone; 0 is the surface. */
  floorFt?: number;
  /** The ceiling is "up to but not including" (the chart's minus, or T under Class B). */
  ceilingBelow?: boolean;
  /** Distance from this point to the area's nearest edge. */
  clearanceM: number;
}
export interface SuaProperties { kind: SuaKind; name: string }

/**
 * How a floor or ceiling is given. `msl` is feet above mean sea level; `sfc`
 * is the ground itself (feet 0); `agl` is feet above the ground under the
 * sector; `fl` is a flight level, stored in feet (FL180 is 18,000); `unlimited`
 * has no value and is a ceiling only.
 */
const ALTITUDE_REFERENCES = ["msl", "sfc", "agl", "fl", "unlimited"] as const;
export type AltitudeReference = (typeof ALTITUDE_REFERENCES)[number];

/** The vertical limits every volume carries. */
export interface VolumeAltitudes {
  /** Feet; 0 when the floor is the surface. */
  floorFt: number;
  floorRef: Exclude<AltitudeReference, "unlimited">;
  /** Feet; absent only when the ceiling is unlimited. */
  ceilingFt?: number;
  ceilingRef: Exclude<AltitudeReference, "sfc">;
  /** The ceiling is "up to but not including". */
  ceilingBelow?: boolean;
}
/** One Class B, C or D sector. `sector` is unique within the layer and joins a sector's tile pieces. */
export interface AirspaceVolumeProperties extends VolumeAltitudes { class: AirspaceClass; name: string; sector: number }
/** One special use airspace record. `exclusion` marks a pocket whose floor differs from the area around it. */
export interface SuaVolumeProperties extends VolumeAltitudes { kind: SuaKind; name: string; sector: number; exclusion?: boolean }
export interface RunwayProperties { airport: string; runway: string; widthFt: number; lengthFt: number }
/** One runway centerline, `[x1, y1, x2, y2]` in meters east and north of the airport reference point. */
export type RunwayPatternSegment = [number, number, number, number];

export interface AirportProperties {
  ident: string;
  name: string;
  kind: AirportKind;
  use: AirportUse;
  towered: boolean;
  longestRunwayFt?: number;
  /** Longest hard-surfaced (asphalt, concrete) runway, which picks the sectional symbol. */
  hardRunwayFt?: number;
  /** Fuel is sold on the field. */
  fuel?: boolean;
  /** A rotating beacon operates sunset to sunrise. */
  beacon?: boolean;
  /** A military field with civil operations (the civil-military symbol). */
  jointUse?: boolean;
  /** Every land runway, for airports charted with their runway layout. */
  runwayPattern?: RunwayPatternSegment[];
}
export interface NavaidProperties { ident: string; name: string; kind: NavaidKind }
export interface ObstacleProperties {
  aglFt: number;
  lit: boolean;
  /** High-intensity white strobes, which the sectional marks with rays. */
  highIntensity?: boolean;
  windTurbine?: boolean;
  /** Obstacles charted as this one record, when more than one. */
  quantity?: number;
}

export interface AviationPropertiesByLayer {
  airspace: AirspaceProperties;
  airspace_labels: AirspaceLabelProperties;
  sua: SuaProperties;
  runways: RunwayProperties;
  airports: AirportProperties;
  navaids: NavaidProperties;
  obstacles: ObstacleProperties;
  airspace_volumes: AirspaceVolumeProperties;
  sua_volumes: SuaVolumeProperties;
}

/**
 * Deepest zoom the volume layers are written at. Sector edges at zoom 10 sit
 * within about 10 m, far below what a model shows, and stopping there keeps
 * the polygons out of the zoom 11 and 12 tiles every engraved-aviation load reads.
 */
export const AIRSPACE_VOLUME_MAX_ZOOM = 10;
export const AIRSPACE_VOLUME_LAYERS = ["airspace_volumes", "sua_volumes"] as const satisfies readonly AviationLayer[];

/** Geometry each layer carries in the archive (vector tile type 1 point, 2 line, 3 polygon). */
export const AVIATION_LAYER_GEOMETRY: Record<AviationLayer, "point" | "line" | "polygon"> = {
  airspace: "line", airspace_labels: "point", sua: "line", runways: "line", airports: "point", navaids: "point", obstacles: "point",
  airspace_volumes: "polygon", sua_volumes: "polygon",
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

const flag = (raw: Raw, key: string): boolean | undefined => typeof raw[key] === "boolean" ? raw[key] as boolean : undefined;

/** Longest runway pattern accepted: a dozen runways of 40 characters. */
const MAX_PATTERN_LENGTH = 480;
const PATTERN_EXTENT_M = 20_000;

/** The builder writes a pattern as `x1,y1,x2,y2;...` in whole meters. */
function runwayPattern(raw: Raw): RunwayPatternSegment[] | undefined {
  const value = raw.runway_pattern;
  if (typeof value !== "string" || !value || value.length > MAX_PATTERN_LENGTH) return undefined;
  const segments = value.split(";").map((segment) => segment.split(",").map(Number));
  return segments.every((segment) => segment.length === 4 && segment.every((n) => Number.isInteger(n) && Math.abs(n) <= PATTERN_EXTENT_M))
    ? segments as RunwayPatternSegment[] : undefined;
}

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

function parseAirspaceLabel(raw: Raw): AirspaceLabelProperties | undefined {
  const cls = member(AIRSPACE_CLASSES, raw.class);
  const area = raw.area;
  const ceilingFt = feet(raw, "ceiling_ft", 60_000);
  const clearanceM = feet(raw, "clearance_m", 1_000_000);
  if (!cls || typeof area !== "number" || !Number.isInteger(area) || area < 0 || ceilingFt === undefined || !clearanceM) return undefined;
  const floorFt = feet(raw, "floor_ft", 60_000);
  if (cls !== "D" && floorFt === undefined) return undefined;
  return compact({ class: cls, area, ceilingFt, floorFt, ceilingBelow: raw.ceiling_below === true ? true : undefined, clearanceM });
}

function parseSua(raw: Raw): SuaProperties | undefined {
  const kind = member(SUA_KINDS, raw.kind);
  const name = text(raw, "name");
  return kind && name ? { kind, name } : undefined;
}

/** Highest altitude a volume may carry, in feet: FL600, the top of charted special use airspace. */
const MAX_VOLUME_FT = 60_000;

function volumeAltitudes(raw: Raw): VolumeAltitudes | undefined {
  const floorRef = member(ALTITUDE_REFERENCES, raw.floor_ref);
  const ceilingRef = member(ALTITUDE_REFERENCES, raw.ceiling_ref);
  const floorFt = feet(raw, "floor_ft", MAX_VOLUME_FT);
  const ceilingFt = feet(raw, "ceiling_ft", MAX_VOLUME_FT);
  if (!floorRef || floorRef === "unlimited" || floorFt === undefined || (floorRef === "sfc") !== (floorFt === 0)) return undefined;
  if (!ceilingRef || ceilingRef === "sfc" || (ceilingRef === "unlimited") !== (ceilingFt === undefined) || ceilingFt === 0) return undefined;
  // Floor and ceiling measured from the same datum must enclose some height.
  if (ceilingFt !== undefined && (floorRef === ceilingRef || floorRef === "sfc") && ceilingFt <= floorFt) return undefined;
  return compact({ floorFt, floorRef, ceilingFt, ceilingRef, ceilingBelow: raw.ceiling_below === true ? true : undefined });
}

const sectorNumber = (raw: Raw): number | undefined => {
  const value = raw.sector;
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
};

function parseAirspaceVolume(raw: Raw): AirspaceVolumeProperties | undefined {
  const cls = member(AIRSPACE_CLASSES, raw.class);
  const name = text(raw, "name");
  const sector = sectorNumber(raw);
  const altitudes = volumeAltitudes(raw);
  return cls && name && sector !== undefined && altitudes ? { class: cls, name, sector, ...altitudes } : undefined;
}

function parseSuaVolume(raw: Raw): SuaVolumeProperties | undefined {
  const kind = member(SUA_KINDS, raw.kind);
  const name = text(raw, "name");
  const sector = sectorNumber(raw);
  const altitudes = volumeAltitudes(raw);
  if (!kind || !name || sector === undefined || !altitudes) return undefined;
  return compact({ kind, name, sector, ...altitudes, exclusion: raw.exclusion === true ? true : undefined });
}

function parseRunway(raw: Raw): RunwayProperties | undefined {
  const airport = text(raw, "airport", 8);
  const runway = text(raw, "runway", 16);
  const widthFt = feet(raw, "width_ft", 2_000);
  const lengthFt = feet(raw, "length_ft", 30_000);
  if (!airport || !runway || !widthFt || !lengthFt) return undefined;
  return { airport, runway, widthFt, lengthFt };
}

function parseAirport(raw: Raw): AirportProperties | undefined {
  const ident = text(raw, "ident", 8);
  const name = text(raw, "name");
  const kind = member(AIRPORT_KINDS, raw.kind);
  const use = member(AIRPORT_USES, raw.use);
  if (!ident || !name || !kind || !use || typeof raw.towered !== "boolean") return undefined;
  return compact({
    ident, name, kind, use, towered: raw.towered,
    longestRunwayFt: feet(raw, "longest_runway_ft", 30_000), hardRunwayFt: feet(raw, "hard_runway_ft", 30_000),
    fuel: flag(raw, "fuel"), beacon: flag(raw, "beacon"), jointUse: flag(raw, "joint_use"), runwayPattern: runwayPattern(raw),
  });
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
  const quantity = raw.quantity;
  return compact({
    aglFt, lit: raw.lit, highIntensity: flag(raw, "high_intensity"), windTurbine: flag(raw, "wind_turbine"),
    quantity: typeof quantity === "number" && Number.isInteger(quantity) && quantity >= 2 && quantity <= 99 ? quantity : undefined,
  });
}

const PARSERS: { [L in AviationLayer]: (raw: Raw) => AviationPropertiesByLayer[L] | undefined } = {
  airspace: parseAirspace, airspace_labels: parseAirspaceLabel, sua: parseSua, runways: parseRunway, airports: parseAirport, navaids: parseNavaid, obstacles: parseObstacle,
  airspace_volumes: parseAirspaceVolume, sua_volumes: parseSuaVolume,
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
  const encode = (entry: unknown) => Array.isArray(entry) ? entry.map((segment: number[]) => segment.join(",")).join(";") : entry as string | number | boolean;
  const properties = Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined).map(([key, entry]) => [snake(key), encode(entry)]));
  const parsed = parseAviationProperties(layer, properties);
  if (!parsed || Object.keys(parsed).length !== Object.keys(properties).length) throw new Error(`Feature does not satisfy the ${layer} contract.`);
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
    if (!isMercatorBoundsTuple(bounds)) throw new Error(`Invalid aviation coverage bounds: ${id}`);
    ids.add(id);
    return { id, bounds: [...bounds] };
  });
  return { ...metadata, name: required("name"), url, license: required("license"), maxZoom, coverage };
}

/** True when a crop (west, south, east, north) touches published FAA coverage. */
export function aviationCovers(sources: Pick<AviationSources, "coverage">, bounds: { west: number; south: number; east: number; north: number }): boolean {
  return sources.coverage.some(({ bounds: [west, south, east, north] }) => bounds.west < east && bounds.east > west && bounds.south < north && bounds.north > south);
}
