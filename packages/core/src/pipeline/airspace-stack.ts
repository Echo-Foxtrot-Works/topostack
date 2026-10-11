import { ringBounds, signedArea, type Bounds2D } from "../primitives/geometry2d.js";
import { clipPolygons, offsetPolygons, windowPolygons } from "../primitives/offset.js";
import { normalizedPolygons } from "./water-inserts.js";
import { AIRSPACE_MIN_PIECE_MM2, partitionAirspace } from "./airspace-partition.js";
import { annotateAirspace } from "./airspace-annotations.js";
import { placeAirspaceSupports } from "./airspace-supports.js";
import { AIRSPACE_DEFAULT_CAP_FT, airspaceMaterial, airspaceStackTint, airspaceTint, type AirspaceStageMemo } from "./airspace-settings.js";
import type {
  AirspaceLevelIR, AirspacePieceIR, AirspaceStackIR, AirspaceStackSettingsV1, AirspaceTint, AirspaceVolumeV1,
  GeometryWarning, LayerIR, Point2D, Polygon2D, ProjectConfigV1, SourceBundleV1, WaterInsertIR,
} from "../types.js";
import type { ElevationLadder } from "./generation-context.js";

/**
 * Airspace built in acrylic above the terrain stack (docs/plans/airspace-acrylic.md).
 *
 * Each sector is a prism: an area with a floor and a ceiling. They share the
 * terrain's vertical scale, so a shelf at 8,000 ft sits where an 8,000 ft
 * summit would. The distinct floors and ceilings are the levels; levels too
 * close for a rod between them merge into the lower one. Pieces are unions of
 * sectors, closed by half the minimum feature so no slot thinner than the
 * laser can cut survives, and cut back wherever the terrain rises through them.
 */

const FEET = 0.3048;
/** Room for a rod between two levels beyond the acrylic itself. */
const AIRSPACE_LEVEL_ROOM_MM = 2;
/** Gap kept between a piece and terrain that rises through it. */
const AIRSPACE_TERRAIN_CLEARANCE_MM = 1;
/** Taller than this and the model is hard to build, ship and display. */
const AIRSPACE_TALL_MM = 250;
/** Volumes using more acrylic than this many model footprints are flagged. */
const AIRSPACE_HEAVY_FOOTPRINTS = 4;
/** Bound slab construction before clipping or support placement can monopolize a worker. */
const MAX_AIRSPACE_VOLUME_SHEETS = 256;

function classEnabled(volume: AirspaceVolumeV1, classes: AirspaceStackSettingsV1["classes"]): boolean {
  switch (volume.aviationClass) {
    case "class-b": return classes.B;
    case "class-c": return classes.C;
    case "class-d": return classes.D;
    case "special-use": return classes.specialUse;
  }
}

/** One prism of airspace after its limits are resolved: altitudes in metres MSL, a null floor standing on the ground. */
interface Part {
  volume: AirspaceVolumeV1;
  polygons: Polygon2D[];
  floorM: number | null;
  ceilingM: number;
  /** Altitudes that came from the ground under the part and snap up to a level rather than making one. */
  floorFromGround: boolean;
  ceilingFromGround: boolean;
}

interface Scale {
  thicknessMm: number;
  /** Elevation of sheet 0's top face. */
  baseM: number;
  metersPerLayer: number;
  /** Model millimetres per metre of altitude. */
  mmPerMeter: number;
  z: (altitudeM: number) => number;
}

function polygonArea(polygon: Polygon2D): number {
  return Math.abs(signedArea(polygon.outer)) - polygon.holes.reduce((sum, hole) => sum + Math.abs(signedArea(hole)), 0);
}

const totalArea = (polygons: Polygon2D[]) => polygons.reduce((sum, polygon) => sum + polygonArea(polygon), 0);

function boundsOf(polygons: Polygon2D[]): Bounds2D {
  const bounds = ringBounds(polygons.flatMap((polygon) => polygon.outer));
  return { minX: bounds.minX - 1, minY: bounds.minY - 1, maxX: bounds.maxX + 1, maxY: bounds.maxY + 1 };
}

/**
 * Closed by half the minimum feature: tile seams and slivers between sectors
 * disappear, and so does any notch the laser cannot cut. The outward offset
 * unions overlapping and abutting polygons itself; a separate union first
 * cost seconds on terraced sectors, whose many parts share edges exactly.
 */
function closed(polygons: Polygon2D[], minimumFeatureMm: number): Polygon2D[] {
  if (!polygons.length) return [];
  const radius = minimumFeatureMm / 2;
  return offsetPolygons(offsetPolygons(polygons, radius, "miter"), -radius, "miter");
}

/** A sector whose floor or ceiling is given above the ground under it, with its area over each sheet. */
interface GroundSector {
  volume: AirspaceVolumeV1;
  /** `over[k]`: the part of the sector over sheet k or higher. Sheets nest, so each is cut from the one before. */
  over: Polygon2D[][];
  /** Altitude of the top face of each sheet. */
  groundM: number[];
  floor: (groundM: number) => number | null;
  ceiling: (groundM: number) => number;
  floorFromGround: boolean;
  ceilingFromGround: boolean;
}

function overSheets(polygons: Polygon2D[], layers: LayerIR[]): Polygon2D[][] {
  const window = boundsOf(polygons);
  const over: Polygon2D[][] = [polygons];
  for (let index = 1; index < layers.length; index += 1) {
    const next = clipPolygons(over[index - 1]!, windowPolygons(layers[index]!.polygons, window), "intersection");
    if (!next.length) break;
    over.push(next);
  }
  return over;
}

/** Resolve one sector's limits: a part with fixed limits, or a sector to be stepped over the ground once the levels are known. */
function resolveSector(volume: AirspaceVolumeV1, polygons: Polygon2D[], settings: AirspaceStackSettingsV1, capM: number, layers: LayerIR[], scale: Scale): Part | GroundSector | undefined {
  const lid = volume.aviationClass === "class-d";
  const fixed = (altitude: AirspaceVolumeV1["ceiling"]) => (altitude.ref === "msl" || altitude.ref === "fl" ? altitude.ft * FEET : undefined);
  const ceilingFixed = volume.ceiling.ref === "unlimited" ? capM : fixed(volume.ceiling);
  // Tiers give a sector that starts at the surface a floor just above the ground, as one 0 ft above it.
  const surfaceFloor = volume.floor.ref === "sfc" && settings.form === "tiers" && !lid;
  const floorFromGround = volume.floor.ref === "agl" || surfaceFloor;
  const ceilingFromGround = volume.ceiling.ref === "agl";
  const floorFixed = volume.floor.ref === "sfc" ? null : fixed(volume.floor) ?? null;
  if (!floorFromGround && !ceilingFromGround) {
    const ceilingM = Math.min(ceilingFixed!, capM);
    return floorFixed !== null && floorFixed >= ceilingM ? undefined : { volume, polygons, floorM: floorFixed, ceilingM, floorFromGround: false, ceilingFromGround: false };
  }
  const floorAbove = volume.floor.ref === "agl" ? volume.floor.ft * FEET : 0;
  const ceilingAbove = volume.ceiling.ref === "agl" ? volume.ceiling.ft * FEET : 0;
  const over = overSheets(polygons, layers);
  return {
    volume, over, floorFromGround, ceilingFromGround,
    groundM: over.map((_, index) => scale.baseM + layers[index]!.index * scale.metersPerLayer),
    floor: (groundM) => (floorFromGround ? groundM + floorAbove : floorFixed),
    ceiling: (groundM) => Math.min(ceilingFromGround ? groundM + ceilingAbove : ceilingFixed!, capM),
  };
}

/**
 * A stepped sector as parts: its sheets grouped by the level each step's floor
 * snaps up to (the first fixed altitude at or above it, below its ceiling),
 * and steps that meet no level grouped by `spanLayers` sheets of ground. Each
 * group is one region cut from the sheets once, so a piece is never a pile of
 * contour-thin fragments. A step's floor is its highest ground plus the height
 * above it, and its ceiling the lowest, so the step clears the ground it spans.
 */
function steppedParts(sector: GroundSector, fixed: number[], spanLayers: number): Part[] {
  const top = sector.over.length - 1;
  const keys = sector.groundM.map((ground, index) => {
    const floor = sector.floor(ground);
    const ceiling = sector.ceiling(ground);
    const snapped = sector.floorFromGround && floor !== null ? fixed.find((level) => level >= floor - 1e-6 && level < ceiling) : undefined;
    const floorKey = !sector.floorFromGround ? "fixed" : snapped !== undefined ? `level-${snapped}` : `ground-${Math.floor(index / spanLayers)}`;
    const ceilingKey = sector.ceilingFromGround ? `ground-${Math.floor(index / spanLayers)}` : "fixed";
    return { key: `${floorKey}|${ceilingKey}`, snapped };
  });
  const parts: Part[] = [];
  for (let low = 0; low <= top;) {
    let high = low;
    while (high + 1 <= top && keys[high + 1]!.key === keys[low]!.key) high += 1;
    const polygons = high < top ? clipPolygons(sector.over[low]!, sector.over[high + 1]!, "difference") : sector.over[low]!;
    const floor = keys[low]!.snapped ?? sector.floor(sector.groundM[high]!);
    const ceiling = sector.ceiling(sector.groundM[low]!);
    if (polygons.length && (floor === null || floor < ceiling)) {
      parts.push({ volume: sector.volume, polygons, floorM: floor, ceilingM: ceiling, floorFromGround: sector.floorFromGround, ceilingFromGround: sector.ceilingFromGround });
    }
    low = high + 1;
  }
  return parts;
}

/**
 * Levels from the parts' floors and ceilings. Altitudes closer than `gapMm`
 * merge into the lower one. A terrace's altitude never makes a level of its
 * own when a level sits above it below its other limit: it snaps up to it.
 */
function levelsOf(parts: Part[], scale: Scale, gapMm: number): { altitudes: number[][]; snap: (altitudeM: number) => number } {
  const fixed = new Set<number>();
  for (const part of parts) {
    if (part.floorM !== null && !part.floorFromGround) fixed.add(part.floorM);
    if (!part.ceilingFromGround) fixed.add(part.ceilingM);
  }
  const ordered = () => [...fixed].sort((a, b) => a - b);
  for (const part of parts) {
    if (part.floorM !== null && part.floorFromGround && !ordered().some((altitude) => altitude >= part.floorM! && altitude < part.ceilingM)) fixed.add(part.floorM);
    // A ground-relative ceiling may merge down, but must never snap up to a
    // different sector's ceiling and invent airspace above its charted limit.
    if (part.ceilingFromGround) fixed.add(part.ceilingM);
  }
  const groups: number[][] = [];
  for (const altitude of ordered()) {
    const last = groups.at(-1);
    if (last && scale.z(altitude) - scale.z(last[0]!) < gapMm) last.push(altitude);
    else groups.push([altitude]);
  }
  const lowest = groups.map((group) => group[0]!);
  const snap = (altitudeM: number): number => {
    const own = groups.find((group) => group.includes(altitudeM));
    if (own) return own[0]!;
    // A terrace altitude: the first level at or above it.
    return lowest.find((level) => level >= altitudeM - 1e-6) ?? lowest.at(-1)!;
  };
  return { altitudes: groups, snap };
}

interface Builder {
  config: ProjectConfigV1;
  layers: LayerIR[];
  scale: Scale;
  thicknessMm: number;
  dropped: { count: number };
  clearance: Map<number, Polygon2D[]>;
  partBounds: Map<Part, Bounds2D>;
  /** Every piece is cut from clear acrylic rather than tinted after the chart. */
  clear: boolean;
}

/** The acrylic a part's piece is cut from. */
const tintOf = (builder: Builder, part: Part): AirspaceTint => (builder.clear ? "clear" : airspaceTint(part.volume));

/** The tints among some parts, blue before magenta. */
function tintsOf(builder: Builder, parts: Part[]): AirspaceTint[] {
  const present = new Set(parts.map((part) => tintOf(builder, part)));
  return (["clear", "blue", "magenta"] as const).filter((tint) => present.has(tint));
}

/** The terrain that rises into a piece whose underside is at `zMm`, grown by the clearance; sheets nest, so the lowest such sheet is all of it. */
function terrainAbove(builder: Builder, zMm: number): Polygon2D[] {
  const index = builder.layers.findIndex((layer) => (layer.index + 1) * builder.scale.thicknessMm > zMm);
  if (index < 0) return [];
  let grown = builder.clearance.get(index);
  if (!grown) {
    grown = offsetPolygons(builder.layers[index]!.polygons, AIRSPACE_TERRAIN_CLEARANCE_MM, "round");
    builder.clearance.set(index, grown);
  }
  return grown;
}

/** A piece's final outline: closed, cut back from the terrain, inside the crop, and without fragments too small to build. */
function pieceOutline(builder: Builder, polygons: Polygon2D[], zMm: number): Polygon2D[] {
  const { config } = builder;
  let outline = closed(polygons, config.minimumFeatureMm);
  const terrain = terrainAbove(builder, zMm);
  if (terrain.length && outline.length) outline = clipPolygons(outline, windowPolygons(terrain, boundsOf(outline)), "difference");
  outline = clipPolygons(outline, builder.layers[0]!.polygons, "intersection");
  const kept = normalizedPolygons(outline, config.minimumFeatureMm);
  const large = kept.filter((polygon) => polygonArea(polygon) >= AIRSPACE_MIN_PIECE_MM2);
  builder.dropped.count += kept.length - large.length;
  return large;
}

function piece(id: string, tint: AirspaceTint, polygons: Polygon2D[], parts: Part[], extra: Partial<AirspacePieceIR> = {}): AirspacePieceIR {
  return { id, tint, polygons, sectorIds: [...new Set(parts.map((part) => part.volume.id))], ...extra };
}

const boxesOverlap = (a: Bounds2D, b: Bounds2D) => a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;

function partBox(builder: Builder, part: Part): Bounds2D {
  let bounds = builder.partBounds.get(part);
  if (!bounds) { bounds = boundsOf(part.polygons); builder.partBounds.set(part, bounds); }
  return bounds;
}

/** The parts that share area with a piece; their boxes rule most out before any boolean. */
function partsWithin(builder: Builder, parts: Part[], polygons: Polygon2D[]): Part[] {
  const box = boundsOf(polygons);
  return parts.filter((part) => boxesOverlap(partBox(builder, part), box) && clipPolygons(part.polygons, polygons, "intersection").length > 0);
}

const isLid = (part: Part) => part.volume.aviationClass === "class-d";

/**
 * A Class D lid marks where Class D ends. Where other airspace carries on
 * through that height, as a Class C shelf over the airport or a restricted
 * area around it does, a lid there would sit inside that airspace, so each
 * lid stops at its edge and the airspace there is shown by its own pieces.
 * `cover` gives the area each lid must leave.
 */
function trimLids(builder: Builder, parts: Part[], cover: (lid: Part) => Polygon2D[]): Part[] {
  return parts.flatMap((part) => {
    if (!isLid(part)) return [part];
    const box = partBox(builder, part);
    const around = cover(part).filter((polygon) => boxesOverlap(boundsOf([polygon]), box));
    if (!around.length) return [part];
    const polygons = clipPolygons(part.polygons, around, "difference");
    return polygons.length ? [{ ...part, polygons }] : [];
  });
}

/** Airspace a lid's ceiling lies inside, by the charted altitudes rather than the merged levels: a shelf merged onto the lid's level still starts below it. */
const enclosing = (parts: Part[]) => (lid: Part) =>
  parts.filter((part) => !isLid(part) && (part.floorM === null || part.floorM < lid.ceilingM - 1e-6) && part.ceilingM > lid.ceilingM + 1e-6).flatMap((part) => part.polygons);

function stepLevels(builder: Builder, parts: Part[], altitudes: number[][], snap: (altitudeM: number) => number, form: "plates" | "tiers"): AirspaceLevelIR[] {
  const { scale } = builder;
  const levels: AirspaceLevelIR[] = [];
  for (const group of altitudes) {
    const altitude = group[0]!;
    const zMm = scale.z(altitude);
    if (zMm < scale.thicknessMm) continue; // below the land: nothing to hold in the air
    const floors = parts.filter((part) => part.floorM !== null && snap(part.floorM) === altitude && !isLid(part));
    const through = parts.filter((part) => !isLid(part) && (part.floorM === null || snap(part.floorM) < altitude) && snap(part.ceilingM) > altitude);
    const ceilings = trimLids(builder, parts.filter((part) => snap(part.ceilingM) === altitude), enclosing(parts));
    // Only lids made this level, and other airspace swallowed them: a plate here would be a bare cross-section.
    if (!floors.length && !ceilings.length) continue;
    const index = levels.length;
    const pieces: AirspacePieceIR[] = [];
    // Plates cut the whole cross-section, tiers only the shelves; each tint is its own piece.
    const shelves = [...floors, ...ceilings];
    const members = form === "plates" ? [...shelves, ...through] : shelves;
    for (const tint of tintsOf(builder, members)) {
      const own = members.filter((part) => tintOf(builder, part) === tint);
      const outline = pieceOutline(builder, own.flatMap((part) => part.polygons), zMm);
      const ownShelves = form === "plates" ? shelves.filter((part) => tintOf(builder, part) === tint) : [];
      const frosted = ownShelves.length && outline.length ? closed(ownShelves.flatMap((part) => part.polygons), builder.config.minimumFeatureMm) : [];
      for (const polygon of outline) {
        const frost = frosted.length ? clipPolygons(frosted, [polygon], "intersection") : [];
        pieces.push(piece(`A${index + 1}-${pieces.length + 1}`, tint, [polygon], partsWithin(builder, own, [polygon]), form === "plates" ? { frost: normalizedPolygons(frost, builder.config.minimumFeatureMm) } : {}));
      }
    }
    if (pieces.length) levels.push({ index, altitudeFt: Math.round(altitude / FEET), mergedFt: group.slice(1).map((value) => Math.round(value / FEET)), zMm, pieces });
  }
  return levels.map((level, index) => index === level.index ? level : renumber(level, index));
}

function renumber(level: AirspaceLevelIR, index: number): AirspaceLevelIR {
  return { ...level, index, pieces: level.pieces.map((entry) => ({ ...entry, id: entry.id.replace(/^A\d+-/, `A${index + 1}-`) })) };
}

/** Volumes: every acrylic sheet from the lowest floor to the highest ceiling, stacked; Class D stays a lid at its ceiling, around the sheets. */
function sliceLevels(builder: Builder, parts: Part[], warnings: GeometryWarning[]): AirspaceLevelIR[] | undefined {
  const { scale, thicknessMm } = builder;
  const solid = parts.filter((part) => !isLid(part));
  const lids = parts.filter(isLid);
  const levels: AirspaceLevelIR[] = [];
  if (solid.length) {
    const bottom = Math.max(scale.thicknessMm, Math.min(...solid.map((part) => (part.floorM === null ? scale.thicknessMm : scale.z(part.floorM)))));
    const top = Math.max(...solid.map((part) => scale.z(part.ceilingM)));
    const sheets = Math.ceil((top - bottom - 1e-6) / thicknessMm);
    if (sheets > MAX_AIRSPACE_VOLUME_SHEETS) {
      warnings.push({ code: "AIRSPACE_TOO_COMPLEX", message: `Solid airspace would require ${sheets} acrylic sheets, exceeding the ${MAX_AIRSPACE_VOLUME_SHEETS}-sheet limit. Use plates or tiers, thicker acrylic, or a lower ceiling cap, then regenerate.` });
      return undefined;
    }
    // Adjacent slabs often have identical sectors and terrain clearance. Reuse
    // their outlines instead of repeating the same union, offsets and clipping.
    const outlines = new Map<string, Array<{ polygon: Polygon2D; parts: Part[] }>>();
    const partIndexes = new Map(solid.map((part, index) => [part, index]));
    for (let zMm = bottom; zMm < top - 1e-6; zMm += thicknessMm) {
      const altitude = scale.baseM + (zMm - scale.thicknessMm) / scale.mmPerMeter;
      const index = levels.length;
      const pieces: AirspacePieceIR[] = [];
      // A sheet belongs to a sector when its middle lies between the floor and the ceiling.
      const middle = altitude + thicknessMm / 2 / scale.mmPerMeter;
      const present = solid.filter((part) => (part.floorM === null || part.floorM <= middle) && part.ceilingM > middle);
      for (const tint of tintsOf(builder, present)) {
        const members = present.filter((part) => tintOf(builder, part) === tint);
        const terrainIndex = builder.layers.findIndex((layer) => (layer.index + 1) * scale.thicknessMm > zMm);
        const key = `${terrainIndex}:${members.map((part) => partIndexes.get(part)).join(",")}`;
        let outline = outlines.get(key);
        if (!outline) {
          outline = pieceOutline(builder, members.flatMap((part) => part.polygons), zMm).map((polygon) => ({ polygon, parts: partsWithin(builder, members, [polygon]) }));
          outlines.set(key, outline);
        }
        for (const entry of outline) {
          pieces.push(piece(`A${index + 1}-${pieces.length + 1}`, tint, [entry.polygon], entry.parts));
        }
      }
      if (pieces.length) levels.push({ index, altitudeFt: Math.round(altitude / FEET), mergedFt: [], zMm, pieces });
    }
  }
  const byCeiling = new Map<number, Part[]>();
  for (const lid of lids) byCeiling.set(lid.ceilingM, [...(byCeiling.get(lid.ceilingM) ?? []), lid]);
  for (const [ceiling, members] of [...byCeiling].sort((a, b) => a[0] - b[0])) {
    const zMm = scale.z(ceiling);
    const index = levels.length;
    // A lid takes only the room the solid sheets beside it leave, never a notch out of them.
    const sheets = levels.filter((level) => Math.abs(level.zMm - zMm) < thicknessMm - 1e-6).flatMap((level) => level.pieces.flatMap((entry) => entry.polygons));
    const trimmed = trimLids(builder, members, () => sheets);
    const pieces = trimmed.length ? pieceOutline(builder, trimmed.flatMap((part) => part.polygons), zMm).map((polygon, n) => piece(`A${index + 1}-${n + 1}`, builder.clear ? "clear" : "blue", [polygon], partsWithin(builder, trimmed, [polygon]))) : [];
    if (pieces.length) levels.push({ index, altitudeFt: Math.round(ceiling / FEET), mergedFt: [], zMm, pieces });
  }
  return levels.sort((a, b) => a.zMm - b.zMm).map((level, index) => renumber(level, index));
}

/** Check only levels whose thicknesses overlap; face-to-face glue contact is allowed. */
function piecesOverlap(levels: AirspaceLevelIR[], thicknessMm: number): boolean {
  const entries = levels.flatMap((level) => level.pieces.map((piece) => ({ piece, zMm: level.zMm, bounds: boundsOf(piece.polygons) })));
  for (let index = 0; index < entries.length; index += 1) {
    const left = entries[index]!;
    for (let next = index + 1; next < entries.length; next += 1) {
      const right = entries[next]!;
      if (right.zMm >= left.zMm + thicknessMm - 1e-6) break;
      if (boxesOverlap(left.bounds, right.bounds) && totalArea(clipPolygons(left.piece.polygons, right.piece.polygons, "intersection")) > 0.01) return true;
    }
  }
  return false;
}

/**
 * Mixes every coordinate of the stage's geometric inputs into two 32-bit
 * lanes. The layers are a fresh clone on every generation, so identity can
 * never match; hashing is linear and costs a few milliseconds where the
 * booleans it spares cost seconds.
 */
function geometryKey(layers: LayerIR[], inserts: WaterInsertIR[], clip: Point2D[]): string {
  let low = 0x811c9dc5, high = 0x9e3779b9, count = 0;
  const mix = (value: number) => {
    low = Math.imul(low ^ (value | 0), 0x01000193) >>> 0;
    high = Math.imul(high ^ (value | 0), 0x5bd1e995) >>> 0;
    high ^= high >>> 13;
  };
  const ring = (points: Point2D[]) => {
    mix(points.length);
    count += points.length;
    // Clipper's own grid: finer than this cannot change a boolean.
    for (const point of points) { mix(Math.round(point.x * 10_000)); mix(Math.round(point.y * 10_000)); }
  };
  const polygons = (entries: Polygon2D[]) => {
    mix(entries.length);
    for (const polygon of entries) { mix(polygon.holes.length); ring(polygon.outer); polygon.holes.forEach(ring); }
  };
  for (const layer of layers) { mix(layer.index); polygons(layer.polygons); }
  for (const insert of inserts) { mix(insert.layerIndex); polygons(insert.polygons); }
  ring(clip);
  return `${layers.length}:${inserts.length}:${count}:${low}:${high}`;
}

/** What the memo keeps: everything before annotation, which is cheap and follows text and line style. */
interface AirspaceMemoEntry {
  source: SourceBundleV1;
  key: string;
  stack: AirspaceStackIR | undefined;
  warnings: GeometryWarning[];
  /** Sheets the rod sockets cut, by layer index, as they were after the cut. */
  socketed: Map<number, Polygon2D[]>;
}

/**
 * The airspace stack for a layered model, or undefined when the project does
 * not ask for one. Runs on the unsplit sheets after water inserts are cut, so
 * every hole a later stage adds to a sheet is already known.
 *
 * Pieces and rods depend only on the settings, the terrain and the airspace
 * data, not on map detail, labels or line style, yet they are most of the
 * work. With a `memo` from the generation session, an edit that leaves those
 * inputs alone reuses them and only annotates again.
 */
export function buildAirspaceStack(config: ProjectConfigV1, source: SourceBundleV1, layers: LayerIR[], ladder: ElevationLadder, clip: Point2D[], inserts: WaterInsertIR[], warnings: GeometryWarning[], memo?: AirspaceStageMemo): AirspaceStackIR | undefined {
  const settings = config.airspaceStack;
  const material = airspaceMaterial(config);
  if (!settings || !material) return undefined;
  if (!source.airspaceVolumes) {
    warnings.push({ code: "AIRSPACE_NOT_LOADED", message: "Airspace was not loaded for this area, so no airspace pieces were made. Airspace data covers the US and its territories." });
    return undefined;
  }
  if (source.airspaceStatus === "partial") warnings.push({ code: "AIRSPACE_DATA_PARTIAL", message: "Airspace data is incomplete. Narrow the map area or turn off some airspace classes, then regenerate before exporting." });
  const volumes = source.airspaceVolumes.filter((volume) => classEnabled(volume, settings.classes));
  const key = memo && [
    JSON.stringify([settings, material, config.materialThicknessMm, config.minimumFeatureMm, ladder.ladderBase, ladder.stack.metersPerLayer]),
    geometryKey(layers, inserts, clip),
  ].join("|");
  const previous = memo?.current as AirspaceMemoEntry | undefined;
  let entry: AirspaceMemoEntry;
  if (previous && previous.source === source && previous.key === key) {
    entry = previous;
    // The layers are this generation's own clone, so the cut sheets go in as copies too.
    for (const [index, polygons] of entry.socketed) {
      const layer = layers.find((candidate) => candidate.index === index);
      if (layer) layer.polygons = structuredClone(polygons);
    }
  } else {
    if (memo) memo.current = undefined;
    const before = layers.map((layer) => layer.polygons);
    const built: GeometryWarning[] = [];
    const stack = piecesAndRods(config, source, layers, ladder, clip, inserts, built, settings, material, volumes);
    const socketed = new Map(layers.filter((layer, index) => layer.polygons !== before[index]).map((layer) => [layer.index, layer.polygons] as const));
    entry = { source, key: key ?? "", stack, warnings: built, socketed };
    if (memo) memo.current = { ...entry, stack: structuredClone(stack), socketed: structuredClone(socketed) };
  }
  warnings.push(...entry.warnings.map((warning) => ({ ...warning })));
  if (!entry.stack) return undefined;
  // Annotation writes into the pieces, so a reused stack is annotated as a copy.
  const stack = entry === previous ? structuredClone(entry.stack) : entry.stack;
  annotateAirspace(stack, volumes, config, warnings);
  const levels = stack.levels;
  const topMm = levels.length ? Math.max(...levels.map((level) => level.zMm + material.thicknessMm)) : 0;
  stack.topMm = topMm;
  if (topMm > AIRSPACE_TALL_MM) warnings.push({
    code: "AIRSPACE_TALL",
    message: `The airspace stands ${Math.round(topMm)} mm tall. Lower the airspace ceiling cap or Vertical exaggeration for a model that is easier to build and display.`,
  });
  if (settings.form === "volumes") {
    const area = levels.reduce((sum, level) => sum + level.pieces.reduce((pieceSum, entry) => pieceSum + totalArea(entry.polygons), 0), 0);
    const footprints = area / (config.widthMm * config.heightMm);
    if (footprints > AIRSPACE_HEAVY_FOOTPRINTS) warnings.push({
      code: "AIRSPACE_ACRYLIC_HEAVY",
      message: `Solid airspace takes acrylic covering the model ${footprints.toFixed(1)} times over. Plates or tiers use far less.`,
    });
  }
  return stack;
}

/** Levels, pieces, rods and their sockets, before any engraving is placed on them. */
function piecesAndRods(config: ProjectConfigV1, source: SourceBundleV1, layers: LayerIR[], ladder: ElevationLadder, clip: Point2D[], inserts: WaterInsertIR[], warnings: GeometryWarning[], settings: AirspaceStackSettingsV1, material: { thicknessMm: number; kerfMm: number }, volumes: AirspaceVolumeV1[]): AirspaceStackIR | undefined {
  const t = config.materialThicknessMm;
  const metersPerLayer = ladder.stack.metersPerLayer;
  const scale: Scale = {
    thicknessMm: t, baseM: ladder.ladderBase, metersPerLayer, mmPerMeter: t / metersPerLayer,
    z: (altitudeM) => t + ((altitudeM - ladder.ladderBase) / metersPerLayer) * t,
  };
  const gapMm = material.thicknessMm + AIRSPACE_LEVEL_ROOM_MM;
  const crop: Polygon2D[] = [{ outer: clip, holes: [] }];
  const charted = volumes
    .filter((volume) => volume.aviationClass === "class-b" || volume.aviationClass === "class-c")
    .flatMap((volume) => (volume.ceiling.ref === "msl" || volume.ceiling.ref === "fl" ? [volume.ceiling.ft] : []));
  const ceilingCapFt = settings.ceilingCapFt ?? (charted.length ? Math.max(...charted) : AIRSPACE_DEFAULT_CAP_FT);
  const spanLayers = Math.max(1, Math.floor(gapMm / t));
  const resolved = volumes.flatMap((volume) => {
    const inside = clipPolygons(volume.polygons, crop, "intersection");
    return (inside.length ? resolveSector(volume, inside, settings, ceilingCapFt * FEET, layers, scale) : undefined) ?? [];
  });
  const fixedParts = resolved.filter((entry): entry is Part => "polygons" in entry);
  const fixedAltitudes = [...new Set(fixedParts.flatMap((part) => [...(part.floorM === null ? [] : [part.floorM]), part.ceilingM]))].sort((a, b) => a - b);
  let parts = [...fixedParts, ...resolved.filter((entry): entry is GroundSector => "over" in entry).flatMap((sector) => steppedParts(sector, fixedAltitudes, spanLayers))];
  // A floor below the land stands on the ground; a part whose ceiling is below it is underground.
  parts = parts
    .map((part) => (part.floorM !== null && !part.floorFromGround && scale.z(part.floorM) <= t ? { ...part, floorM: null } : part))
    .filter((part) => scale.z(part.ceilingM) > t);
  const terraced = new Set(parts.filter((part) => part.floorFromGround || part.ceilingFromGround).map((part) => part.volume.id));
  const builder: Builder = { config, layers, scale, thicknessMm: material.thicknessMm, dropped: { count: 0 }, clearance: new Map(), partBounds: new Map(), clear: airspaceStackTint(settings) === "clear" };
  let levels: AirspaceLevelIR[];
  if (settings.form === "volumes") {
    const sliced = sliceLevels(builder, parts, warnings);
    if (!sliced) return undefined;
    levels = sliced;
  } else {
    const { altitudes, snap } = levelsOf(parts, scale, gapMm);
    levels = stepLevels(builder, parts, altitudes, snap, settings.form);
    const merged = altitudes.filter((group) => group.length > 1);
    if (merged.length) warnings.push({
      code: "AIRSPACE_LEVELS_MERGED",
      message: `${merged.length} airspace ${merged.length === 1 ? "level was" : "levels were"} merged into the level below, because no rod fits between pieces closer than ${gapMm.toFixed(1)} mm. Raise Vertical exaggeration to separate them.`,
    });
  }
  const ceilingCapped = (volume: AirspaceVolumeV1): boolean => {
    const ceiling = volume.ceiling;
    if (ceiling.ref === "unlimited") return true;
    if (ceiling.ref !== "agl") return ceiling.ft > ceilingCapFt;
    return resolved.some((entry) => entry.volume.id === volume.id && "groundM" in entry && entry.groundM.some((ground) => ground / FEET + ceiling.ft > ceilingCapFt));
  };
  const sectors = volumes.filter((volume) => parts.some((part) => part.volume.id === volume.id)).map((volume) => ({
    id: volume.id, name: volume.name, aviationClass: volume.aviationClass,
    ...(volume.specialUseKind ? { specialUseKind: volume.specialUseKind } : {}),
    floor: volume.floor, ceiling: volume.ceiling,
    ...(volume.ceilingBelow ? { ceilingBelow: true } : {}),
    ...(volume.exclusion ? { exclusion: true } : {}),
    ceilingCapped: ceilingCapped(volume),
  }));
  const partitioned = partitionAirspace(levels, sectors, material.thicknessMm, config.minimumFeatureMm);
  levels = partitioned.levels;
  for (const entry of partitioned.ownershipChanged) entry.sectorIds = [...new Set(partsWithin(builder, parts.filter((part) => entry.sectorIds.includes(part.volume.id)), entry.polygons).map((part) => part.volume.id))].sort();
  builder.dropped.count += partitioned.dropped;
  const terracedNames = [...new Set(parts.filter((part) => terraced.has(part.volume.id) && part.volume.floor.ref === "agl").map((part) => part.volume.name))];
  if (terracedNames.length) warnings.push({
    code: "AIRSPACE_TERRACED",
    message: `${terracedNames.slice(0, 3).join(", ")}${terracedNames.length > 3 ? ` and ${terracedNames.length - 3} more` : ""} ${terracedNames.length === 1 ? "has" : "have"} a floor given above ground, built as steps over the terrain.`,
  });
  if (builder.dropped.count) warnings.push({
    code: "AIRSPACE_PIECES_DROPPED",
    message: `${builder.dropped.count} airspace ${builder.dropped.count === 1 ? "piece was" : "pieces were"} left out because ${builder.dropped.count === 1 ? "it was" : "they were"} smaller than 10 cm² after overlap partitioning, terrain and cropping cut ${builder.dropped.count === 1 ? "it" : "them"}.`,
  });
  // Retain the fabrication guard if numerical clipping leaves a conflict.
  if (piecesOverlap(levels, material.thicknessMm)) warnings.push({ code: "AIRSPACE_PIECES_OVERLAP", message: "Airspace acrylic pieces overlap at the same height. Use plates or disable overlapping airspace classes, then regenerate before exporting." });
  const stack: AirspaceStackIR = { form: settings.form, thicknessMm: material.thicknessMm, kerfMm: material.kerfMm, ceilingCapFt, mmPerMeter: scale.mmPerMeter, topMm: 0, levels, sectors, rod: { ...settings.rod }, ...(source.airspaceCycle ? { cycle: source.airspaceCycle } : {}), columns: [], cutList: [], backingSheet: false };
  // Rods hold the pieces, and their sockets become holes in the sheets; a piece no rod can hold is left out.
  placeAirspaceSupports(stack, layers, inserts, t, config.minimumFeatureMm, warnings);
  return stack;
}
