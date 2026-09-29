import { DEFAULT_PLAQUE_SIZE_MM, DEFAULT_PROJECT, MAP_MARKER_SIZE_MM, MARKER_SYMBOLS, MAX_CUSTOM_DATA_NAME_LENGTH, MAX_PROJECT_DIMENSION_MM, MAX_PROJECT_NAME_LENGTH, MAX_VERTICAL_EXAGGERATION, MIN_VERTICAL_EXAGGERATION, MIN_WORK_AREA_MM, northArrowMaximumMm, PLAQUE_MAX_LINE_LENGTH, PLAQUE_MAX_LINES, type AviationDetailsV1, type BuiltInMarkerSymbol, type CropShape, type GeoBounds, type GeoPoint, type MapMarkerV1, type ProjectConfigV1, type UnitSystem } from "../types.js";
import { fnv1aHex, stableStringify } from "../pipeline/fingerprint.js";
import { boundsAround, boundsForProject, coverBounds, isMercatorBounds, zoomForBounds } from "./bounds.js";
import { parseProject } from "./parse.js";

/**
 * The small, agent-friendly way to describe a model. A request names a place,
 * a size and a handful of choices; `expandProjectRequest` turns it into a full
 * `ProjectConfigV1` from the studio's defaults. The REST API, the MCP server
 * and the studio's in-page agent tools all read requests through this module,
 * so one field means one thing everywhere.
 */
export const PROJECT_REQUEST_VERSION = 1;

/** Either a point and how much ground to show across, or a box that must be kept whole. */
export type ProjectRequestArea = { center: GeoPoint; widthKm: number } | { bounds: GeoBounds };

export interface ProjectRequestDetails {
  water?: boolean;
  waterDepth?: boolean;
  roads?: boolean;
  trails?: boolean;
  roadLabels?: boolean;
  boundaries?: boolean;
  coordinateGrid?: boolean;
  elevationLabels?: boolean;
  northArrow?: boolean;
  scaleBar?: boolean;
}

/** FAA aviation detail (US only; decorative, never for navigation). Every switch is off unless set. */
export type ProjectRequestAviation = Partial<AviationDetailsV1>;

export interface ProjectRequestMarker {
  lat: number;
  lon: number;
  symbol?: BuiltInMarkerSymbol;
  name?: string;
}

export interface ProjectRequestLaser {
  kerfMm?: number;
  /** 0 means the bed is large enough for the whole model. */
  workAreaWidthMm?: number;
  workAreaHeightMm?: number;
}

/** Everything a request may set except the area and version; the studio's agent tools edit a design with these. */
export interface ProjectRequestSettings {
  placeLabel?: string;
  name?: string;
  widthMm?: number;
  heightMm?: number;
  shape?: CropShape;
  units?: UnitSystem;
  /** `layered` cuts a stack of sheets; `flat` engraves contour lines on one sheet. */
  output?: "layered" | "flat";
  materialThicknessMm?: number;
  verticalExaggeration?: number;
  /** Flat output only: how many contour lines to engrave. */
  contourCount?: number;
  details?: ProjectRequestDetails;
  aviation?: ProjectRequestAviation;
  /** Up to three lines engraved as a title; an empty string removes it. */
  title?: string;
  laser?: ProjectRequestLaser;
  markers?: ProjectRequestMarker[];
}

export interface ProjectRequestV1 extends ProjectRequestSettings {
  requestVersion: 1;
  area: ProjectRequestArea;
}

export interface RequestIssue { path: string; message: string }
export type RequestResult<T> = { ok: true; value: T } | { ok: false; errors: RequestIssue[] };

/** Limits shared by the parser and the published JSON Schema. */
export const PROJECT_REQUEST_LIMITS = {
  widthKm: { min: 0.1, max: 2000 },
  sizeMm: { min: MIN_WORK_AREA_MM, max: MAX_PROJECT_DIMENSION_MM },
  materialThicknessMm: { min: 0.5, max: 25 },
  verticalExaggeration: { min: MIN_VERTICAL_EXAGGERATION, max: MAX_VERTICAL_EXAGGERATION },
  contourCount: { min: 4, max: 40 },
  kerfMm: { min: 0, max: 1 },
  workAreaMm: { min: MIN_WORK_AREA_MM, max: MAX_PROJECT_DIMENSION_MM },
  placeLabelLength: 240,
  nameLength: MAX_PROJECT_NAME_LENGTH,
  titleLines: PLAQUE_MAX_LINES,
  titleLineLength: PLAQUE_MAX_LINE_LENGTH,
  markers: 20,
  markerNameLength: MAX_CUSTOM_DATA_NAME_LENGTH,
} as const;

export const PROJECT_REQUEST_DETAIL_KEYS = ["water", "waterDepth", "roads", "trails", "roadLabels", "boundaries", "coordinateGrid", "elevationLabels", "northArrow", "scaleBar"] as const satisfies readonly (keyof ProjectRequestDetails)[];

export const PROJECT_REQUEST_AVIATION_KEYS = ["airspace", "specialUse", "runways", "airports", "navaids", "obstacles", "labels"] as const satisfies readonly (keyof AviationDetailsV1)[];

const DETAIL_FIELDS: Record<keyof ProjectRequestDetails, keyof ProjectConfigV1> = {
  water: "showWater",
  waterDepth: "showWaterDepth",
  roads: "showRoads",
  trails: "showTrails",
  roadLabels: "showTransportationLabels",
  boundaries: "showBoundaries",
  coordinateGrid: "showCoordinateGrid",
  elevationLabels: "showElevationLabels",
  northArrow: "showNorthArrow",
  scaleBar: "showScaleBar",
};

const SETTINGS_KEYS = ["placeLabel", "name", "widthMm", "heightMm", "shape", "units", "output", "materialThicknessMm", "verticalExaggeration", "contourCount", "details", "aviation", "title", "laser", "markers"] as const;
const DEFAULT_PLACE_LABEL = "Custom coordinates";
const DEFAULT_NAME = "Terrain model";

const hex = (code: number) => code.toString(16).padStart(4, "0");
const characterClass = (ranges: Array<[number, number]>) => new RegExp(`[${ranges.map(([from, to]) => `\\u${hex(from)}-\\u${hex(to)}`).join("")}]`, "g");
/** C0 and C1 controls except newline; each becomes a space. */
const CONTROL_CHARACTERS = characterClass([[0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x9f]]);
/** Zero-width and bidirectional formatting marks and the byte-order mark; each is removed. */
const INVISIBLE_CHARACTERS = characterClass([[0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]]);

/**
 * Text that came from a person or a geocoder: control and bidirectional
 * formatting characters removed and whitespace collapsed, so it cannot hide
 * instructions or reorder what a reader sees.
 */
export function cleanRequestText(text: string, maxLength: number, keepNewlines = false): string {
  const stripped = text.replace(INVISIBLE_CHARACTERS, "").replace(CONTROL_CHARACTERS, " ");
  const lines = (keepNewlines ? stripped.split("\n") : [stripped.replace(/\n/g, " ")]).map((line) => line.replace(/\s+/g, " ").trim());
  return lines.join("\n").slice(0, maxLength).trim();
}

class Issues {
  readonly list: RequestIssue[] = [];
  add(path: string, message: string): undefined { this.list.push({ path, message }); return undefined; }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: string, issues: Issues): void {
  for (const key of Object.keys(record)) if (!allowed.includes(key)) issues.add(path ? `${path}.${key}` : key, "Unknown field.");
}

function numberIn(value: unknown, path: string, range: { min: number; max: number }, issues: Issues, integer = false): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return issues.add(path, "Must be a number.");
  if (integer && !Number.isInteger(value)) return issues.add(path, "Must be a whole number.");
  if (value < range.min || value > range.max) return issues.add(path, `Must be between ${range.min} and ${range.max}.`);
  return value;
}

function oneOf<T extends string>(value: unknown, path: string, options: readonly T[], issues: Issues): T | undefined {
  if (typeof value === "string" && (options as readonly string[]).includes(value)) return value as T;
  return issues.add(path, `Must be one of: ${options.join(", ")}.`);
}

function text(value: unknown, path: string, maxLength: number, issues: Issues, keepNewlines = false): string | undefined {
  if (typeof value !== "string") return issues.add(path, "Must be text.");
  if (value.length > maxLength * 4) return issues.add(path, `Must contain at most ${maxLength} characters.`);
  return cleanRequestText(value, maxLength, keepNewlines);
}

function latitude(value: unknown, path: string, issues: Issues): number | undefined {
  return numberIn(value, path, { min: -85.0511, max: 85.0511 }, issues);
}
function longitude(value: unknown, path: string, issues: Issues): number | undefined {
  return numberIn(value, path, { min: -180, max: 180 }, issues);
}

function areaValue(value: unknown, issues: Issues): ProjectRequestArea | undefined {
  if (!isRecord(value)) return issues.add("area", "Give either { center: { lat, lon }, widthKm } or { bounds: { west, south, east, north } }.");
  if ("bounds" in value) {
    unknownKeys(value, ["bounds"], "area", issues);
    const bounds = value.bounds;
    if (!isRecord(bounds)) return issues.add("area.bounds", "Must be an object with west, south, east and north.");
    unknownKeys(bounds, ["west", "south", "east", "north"], "area.bounds", issues);
    const west = longitude(bounds.west, "area.bounds.west", issues);
    const east = longitude(bounds.east, "area.bounds.east", issues);
    const south = latitude(bounds.south, "area.bounds.south", issues);
    const north = latitude(bounds.north, "area.bounds.north", issues);
    if (west === undefined || east === undefined || south === undefined || north === undefined) return undefined;
    if (west >= east) return issues.add("area.bounds", "West must be less than east; areas crossing the antimeridian are not supported.");
    if (south >= north) return issues.add("area.bounds", "South must be less than north.");
    return { bounds: { west, south, east, north } };
  }
  unknownKeys(value, ["center", "widthKm"], "area", issues);
  const center = value.center;
  if (!isRecord(center)) return issues.add("area.center", "Must be an object with lat and lon.");
  unknownKeys(center, ["lat", "lon"], "area.center", issues);
  const lat = latitude(center.lat, "area.center.lat", issues);
  const lon = longitude(center.lon, "area.center.lon", issues);
  const widthKm = numberIn(value.widthKm, "area.widthKm", PROJECT_REQUEST_LIMITS.widthKm, issues);
  if (lat === undefined || lon === undefined || widthKm === undefined) return undefined;
  return { center: { lat, lon }, widthKm };
}

function detailsValue(value: unknown, issues: Issues): ProjectRequestDetails | undefined {
  if (!isRecord(value)) return issues.add("details", "Must be an object of true/false switches.");
  unknownKeys(value, PROJECT_REQUEST_DETAIL_KEYS, "details", issues);
  const details: ProjectRequestDetails = {};
  for (const key of PROJECT_REQUEST_DETAIL_KEYS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "boolean") issues.add(`details.${key}`, "Must be true or false.");
    else details[key] = value[key];
  }
  return details;
}

function aviationValue(value: unknown, issues: Issues): ProjectRequestAviation | undefined {
  if (!isRecord(value)) return issues.add("aviation", "Must be an object of true/false switches.");
  unknownKeys(value, PROJECT_REQUEST_AVIATION_KEYS, "aviation", issues);
  const aviation: ProjectRequestAviation = {};
  for (const key of PROJECT_REQUEST_AVIATION_KEYS) {
    if (value[key] === undefined) continue;
    if (typeof value[key] !== "boolean") issues.add(`aviation.${key}`, "Must be true or false.");
    else aviation[key] = value[key];
  }
  return aviation;
}

function laserValue(value: unknown, issues: Issues): ProjectRequestLaser | undefined {
  if (!isRecord(value)) return issues.add("laser", "Must be an object.");
  unknownKeys(value, ["kerfMm", "workAreaWidthMm", "workAreaHeightMm"], "laser", issues);
  const laser: ProjectRequestLaser = {};
  if (value.kerfMm !== undefined) laser.kerfMm = numberIn(value.kerfMm, "laser.kerfMm", PROJECT_REQUEST_LIMITS.kerfMm, issues);
  for (const key of ["workAreaWidthMm", "workAreaHeightMm"] as const) {
    if (value[key] === undefined) continue;
    laser[key] = value[key] === 0 ? 0 : numberIn(value[key], `laser.${key}`, PROJECT_REQUEST_LIMITS.workAreaMm, issues);
  }
  return laser;
}

function markersValue(value: unknown, issues: Issues): ProjectRequestMarker[] | undefined {
  if (!Array.isArray(value)) return issues.add("markers", "Must be a list.");
  if (value.length > PROJECT_REQUEST_LIMITS.markers) return issues.add("markers", `At most ${PROJECT_REQUEST_LIMITS.markers} markers.`);
  return value.map((item, index) => {
    const path = `markers[${index}]`;
    if (!isRecord(item)) return issues.add(path, "Must be an object with lat and lon.");
    unknownKeys(item, ["lat", "lon", "symbol", "name"], path, issues);
    const lat = latitude(item.lat, `${path}.lat`, issues);
    const lon = longitude(item.lon, `${path}.lon`, issues);
    const symbol = item.symbol === undefined ? undefined : oneOf(item.symbol, `${path}.symbol`, MARKER_SYMBOLS, issues);
    const name = item.name === undefined ? undefined : text(item.name, `${path}.name`, PROJECT_REQUEST_LIMITS.markerNameLength, issues);
    return { lat: lat ?? 0, lon: lon ?? 0, ...(symbol ? { symbol } : {}), ...(name ? { name } : {}) };
  }).filter((marker): marker is ProjectRequestMarker => !!marker);
}

function titleValue(value: unknown, issues: Issues): string | undefined {
  const title = text(value, "title", PROJECT_REQUEST_LIMITS.titleLines * (PROJECT_REQUEST_LIMITS.titleLineLength + 1), issues, true);
  if (title === undefined) return undefined;
  const lines = title.split("\n");
  if (lines.length > PROJECT_REQUEST_LIMITS.titleLines) return issues.add("title", `At most ${PROJECT_REQUEST_LIMITS.titleLines} lines.`);
  if (lines.some((line) => line.length > PROJECT_REQUEST_LIMITS.titleLineLength)) return issues.add("title", `Each line may hold at most ${PROJECT_REQUEST_LIMITS.titleLineLength} characters.`);
  return title;
}

function settingsValue(record: Record<string, unknown>, issues: Issues): ProjectRequestSettings {
  const settings: ProjectRequestSettings = {};
  const limits = PROJECT_REQUEST_LIMITS;
  if (record.placeLabel !== undefined) settings.placeLabel = text(record.placeLabel, "placeLabel", limits.placeLabelLength, issues);
  if (record.name !== undefined) settings.name = text(record.name, "name", limits.nameLength, issues);
  if (record.widthMm !== undefined) settings.widthMm = numberIn(record.widthMm, "widthMm", limits.sizeMm, issues);
  if (record.heightMm !== undefined) settings.heightMm = numberIn(record.heightMm, "heightMm", limits.sizeMm, issues);
  if (record.shape !== undefined) settings.shape = oneOf(record.shape, "shape", ["rectangle", "circle"] as const, issues);
  if (record.units !== undefined) settings.units = oneOf(record.units, "units", ["metric", "imperial"] as const, issues);
  if (record.output !== undefined) settings.output = oneOf(record.output, "output", ["layered", "flat"] as const, issues);
  if (record.materialThicknessMm !== undefined) settings.materialThicknessMm = numberIn(record.materialThicknessMm, "materialThicknessMm", limits.materialThicknessMm, issues);
  if (record.verticalExaggeration !== undefined) settings.verticalExaggeration = numberIn(record.verticalExaggeration, "verticalExaggeration", limits.verticalExaggeration, issues);
  if (record.contourCount !== undefined) settings.contourCount = numberIn(record.contourCount, "contourCount", limits.contourCount, issues, true);
  if (record.details !== undefined) settings.details = detailsValue(record.details, issues);
  if (record.aviation !== undefined) settings.aviation = aviationValue(record.aviation, issues);
  if (record.title !== undefined) settings.title = titleValue(record.title, issues);
  if (record.laser !== undefined) settings.laser = laserValue(record.laser, issues);
  if (record.markers !== undefined) settings.markers = markersValue(record.markers, issues);
  return Object.fromEntries(Object.entries(settings).filter(([, entry]) => entry !== undefined)) as ProjectRequestSettings;
}

/** Read an untrusted request, reporting every problem with the path of the field that caused it. */
export function parseProjectRequest(value: unknown): RequestResult<ProjectRequestV1> {
  const issues = new Issues();
  if (!isRecord(value)) return { ok: false, errors: [{ path: "", message: "A request must be a JSON object." }] };
  unknownKeys(value, ["requestVersion", "area", ...SETTINGS_KEYS], "", issues);
  if (value.requestVersion !== PROJECT_REQUEST_VERSION) issues.add("requestVersion", `Must be ${PROJECT_REQUEST_VERSION}.`);
  const area = value.area === undefined ? issues.add("area", "Required: the place to model.") : areaValue(value.area, issues);
  const settings = settingsValue(value, issues);
  if (issues.list.length || !area) return { ok: false, errors: issues.list };
  const request: ProjectRequestV1 = { requestVersion: 1, area, ...settings };
  const expanded = tryExpand(request);
  return expanded.ok ? { ok: true, value: request } : expanded;
}

/** Read an untrusted change to an existing design: any settings, and optionally a new area. */
export function parseProjectRequestPatch(value: unknown): RequestResult<ProjectRequestSettings & { area?: ProjectRequestArea }> {
  const issues = new Issues();
  if (!isRecord(value)) return { ok: false, errors: [{ path: "", message: "A change must be a JSON object." }] };
  unknownKeys(value, ["area", ...SETTINGS_KEYS], "", issues);
  const area = value.area === undefined ? undefined : areaValue(value.area, issues);
  const settings = settingsValue(value, issues);
  if (issues.list.length) return { ok: false, errors: issues.list };
  return { ok: true, value: { ...settings, ...(area ? { area } : {}) } };
}

function tryExpand(request: ProjectRequestV1): RequestResult<ProjectConfigV1> {
  try {
    return { ok: true, value: expandProjectRequest(request) };
  } catch (error) {
    return { ok: false, errors: [{ path: "", message: error instanceof Error ? error.message : String(error) }] };
  }
}

/** The geographic crop an area asks for, fitted to the cut's aspect ratio. */
export function areaBounds(area: ProjectRequestArea, widthMm: number, heightMm: number): GeoBounds {
  return "bounds" in area ? coverBounds(area.bounds, widthMm, heightMm) : boundsAround(area.center, area.widthKm, widthMm, heightMm);
}

/**
 * The project fields a change sets on `project`. Size changes keep the north
 * arrow within the largest size the new map allows, as the studio does.
 */
export function requestPatch(project: ProjectConfigV1, change: ProjectRequestSettings & { area?: ProjectRequestArea }): Partial<ProjectConfigV1> {
  const patch: Partial<ProjectConfigV1> = {};
  const widthMm = change.widthMm ?? project.widthMm;
  const heightMm = change.heightMm ?? project.heightMm;
  if (change.widthMm !== undefined) patch.widthMm = change.widthMm;
  if (change.heightMm !== undefined) patch.heightMm = change.heightMm;
  if (change.widthMm !== undefined || change.heightMm !== undefined) patch.northArrowSizeMm = Math.min(project.northArrowSizeMm, northArrowMaximumMm(widthMm, heightMm));
  if (change.area || change.placeLabel !== undefined) {
    const bounds = change.area ? areaBounds(change.area, widthMm, heightMm) : project.location.bounds;
    const center = change.area ? ("center" in change.area ? change.area.center : { lat: (bounds!.south + bounds!.north) / 2, lon: (bounds!.west + bounds!.east) / 2 }) : project.location;
    patch.location = {
      lat: center.lat, lon: center.lon,
      label: change.placeLabel || (change.area ? DEFAULT_PLACE_LABEL : project.location.label),
      zoom: change.area && bounds ? zoomForBounds(bounds) : project.location.zoom,
      ...(bounds ? { bounds } : {}),
    };
  }
  if (change.name) patch.name = change.name;
  if (change.shape) patch.cropShape = change.shape;
  if (change.units) patch.units = change.units;
  if (change.output) patch.outputMode = change.output === "flat" ? "engraving" : "stack";
  if (change.materialThicknessMm !== undefined) patch.materialThicknessMm = change.materialThicknessMm;
  if (change.verticalExaggeration !== undefined) patch.verticalExaggeration = change.verticalExaggeration;
  if (change.contourCount !== undefined) patch.engravingContourCount = change.contourCount;
  for (const key of PROJECT_REQUEST_DETAIL_KEYS) {
    const enabled = change.details?.[key];
    if (enabled !== undefined) (patch as Record<string, unknown>)[DETAIL_FIELDS[key]] = enabled;
  }
  if (change.aviation) {
    const aviation = Object.fromEntries(PROJECT_REQUEST_AVIATION_KEYS.map((key) => [key, change.aviation![key] ?? project.aviation?.[key] ?? false])) as unknown as AviationDetailsV1;
    // All off drops the setting, so the design reads exactly as one without aviation.
    patch.aviation = PROJECT_REQUEST_AVIATION_KEYS.some((key) => aviation[key]) ? aviation : undefined;
  }
  if (change.title !== undefined) {
    patch.plaque = change.title
      ? { enabled: true, text: change.title, sizeMm: project.plaque?.sizeMm ?? DEFAULT_PLAQUE_SIZE_MM, placement: project.plaque?.placement ?? { anchor: "bottom-left", offset: { x: 0, y: 0 } }, ...(project.plaque?.font ? { font: project.plaque.font } : {}) }
      : project.plaque ? { ...project.plaque, enabled: false } : undefined;
  }
  if (change.laser?.kerfMm !== undefined) patch.laserKerfMm = change.laser.kerfMm;
  if (change.laser?.workAreaWidthMm !== undefined) patch.workAreaWidthMm = change.laser.workAreaWidthMm;
  if (change.laser?.workAreaHeightMm !== undefined) patch.workAreaHeightMm = change.laser.workAreaHeightMm;
  if (change.markers) {
    patch.markers = change.markers.map((marker, index): MapMarkerV1 => ({
      id: `marker-${index + 1}`, lat: marker.lat, lon: marker.lon, symbol: marker.symbol ?? "pin", sizeMm: MAP_MARKER_SIZE_MM,
      ...(marker.name ? { name: marker.name } : {}),
    }));
  }
  return patch;
}

/**
 * The full project a request describes: the studio's defaults with the
 * request applied, checked by the same parser as an imported file. Its id is
 * derived from the request, so the same request always yields the same link.
 */
export function expandProjectRequest(request: ProjectRequestV1): ProjectConfigV1 {
  const patch = requestPatch(DEFAULT_PROJECT, request);
  const bounds = patch.location?.bounds;
  if (!bounds || !isMercatorBounds(bounds)) throw new Error("The area, fitted to the model's proportions, extends beyond the mapped world (±85° latitude, ±180° longitude). Choose a smaller area or move it away from the poles and the antimeridian.");
  const name = request.name || cleanRequestText(request.placeLabel?.split(",")[0] ?? "", MAX_PROJECT_NAME_LENGTH) || DEFAULT_NAME;
  const { explodedPreview: _preview, ...design } = DEFAULT_PROJECT;
  return parseProject({
    ...design,
    ...patch,
    schemaVersion: 1,
    id: `agent-${fnv1aHex(stableStringify(request))}`,
    name,
  });
}

/** A project described as request settings, for agents reading a design they did not write. */
export function describeProject(project: ProjectConfigV1): ProjectRequestV1 {
  const details = Object.fromEntries(PROJECT_REQUEST_DETAIL_KEYS.map((key) => [key, project[DETAIL_FIELDS[key]] as boolean])) as Required<ProjectRequestDetails>;
  return {
    requestVersion: 1,
    area: { bounds: boundsForProject(project) },
    placeLabel: project.location.label,
    name: project.name,
    widthMm: project.widthMm,
    heightMm: project.heightMm,
    shape: project.cropShape,
    units: project.units,
    output: project.outputMode === "engraving" ? "flat" : "layered",
    materialThicknessMm: project.materialThicknessMm,
    verticalExaggeration: project.verticalExaggeration,
    contourCount: project.engravingContourCount,
    details,
    ...(project.aviation ? { aviation: { ...project.aviation } } : {}),
    ...(project.plaque?.enabled ? { title: project.plaque.text } : {}),
    laser: { kerfMm: project.laserKerfMm, workAreaWidthMm: project.workAreaWidthMm, workAreaHeightMm: project.workAreaHeightMm },
    markers: project.markers.filter((marker) => marker.symbol !== "custom").map((marker) => ({ lat: marker.lat, lon: marker.lon, symbol: marker.symbol as BuiltInMarkerSymbol, ...(marker.name ? { name: marker.name } : {}) })),
  };
}
