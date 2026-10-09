import { clipPolyline, ringBounds, signedArea, type Bounds2D } from "../primitives/geometry2d.js";
import { clipPolygons, offsetPolygons, windowPolygons } from "../primitives/offset.js";
import { normalizedPolygons } from "./water-inserts.js";
import type {
  AirspaceEdgeIR, AirspaceLevelIR, AirspacePieceIR, AirspaceStackIR, AirspaceStackSettingsV1, AirspaceTint, AirspaceVolumeV1,
  GeometryWarning, LayerIR, Point2D, Polygon2D, ProjectConfigV1, SourceBundleV1,
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
/** Ceiling cap when the crop has no Class B or C to take it from. */
export const AIRSPACE_DEFAULT_CAP_FT = 10_000;
/** Room for a rod between two levels beyond the acrylic itself. */
const AIRSPACE_LEVEL_ROOM_MM = 2;
/** Gap kept between a piece and terrain that rises through it. */
const AIRSPACE_TERRAIN_CLEARANCE_MM = 1;
/** Smallest piece worth cutting, setting on rods and gluing: 10 cm². */
const AIRSPACE_MIN_PIECE_MM2 = 1_000;
/** Taller than this and the model is hard to build, ship and display. */
const AIRSPACE_TALL_MM = 250;
/** Volumes using more acrylic than this many model footprints are flagged. */
const AIRSPACE_HEAVY_FOOTPRINTS = 4;

/** What turning airspace on starts from: plates of Class B, C and special use airspace on 4 mm round rods glued in segments. */
export const DEFAULT_AIRSPACE_STACK: AirspaceStackSettingsV1 = {
  form: "plates",
  classes: { B: true, C: true, D: false, specialUse: true },
  rod: { shape: "round", sizeMm: 4, fitClearanceMm: 0.1, socketDepthMm: 6, joint: "segments" },
};

/** The acrylic as the project resolves it, every optional value filled from the wood. */
export function airspaceMaterial(config: ProjectConfigV1): { thicknessMm: number; kerfMm: number } | undefined {
  const settings = config.airspaceStack;
  if (!settings) return undefined;
  return { thicknessMm: settings.thicknessMm ?? config.materialThicknessMm, kerfMm: settings.kerfMm ?? config.laserKerfMm };
}

/** Acrylic colour after the sectional: blue for Class B and D and the prohibited, restricted and warning areas; magenta for Class C, MOAs and alert areas. */
export function airspaceTint(volume: Pick<AirspaceVolumeV1, "aviationClass" | "specialUseKind">): Exclude<AirspaceTint, "clear"> {
  if (volume.aviationClass === "class-c") return "magenta";
  if (volume.aviationClass === "special-use") return volume.specialUseKind === "moa" || volume.specialUseKind === "alert" ? "magenta" : "blue";
  return "blue";
}

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

const union = (polygons: Polygon2D[]) => (polygons.length ? clipPolygons(polygons, [], "union") : []);

/** Closed by half the minimum feature: tile seams and slivers between sectors disappear, and so does any notch the laser cannot cut. */
function closed(polygons: Polygon2D[], minimumFeatureMm: number): Polygon2D[] {
  if (!polygons.length) return [];
  const radius = minimumFeatureMm / 2;
  return offsetPolygons(offsetPolygons(polygons, radius, "miter"), -radius, "miter");
}

/**
 * A part's area split by the terrain under it, each band no more than `spanLayers`
 * sheets of ground deep, with the highest ground in the band. Ground is read
 * from the cut sheets themselves, so a piece over a band clears what was cut.
 */
function groundBands(polygons: Polygon2D[], layers: LayerIR[], scale: Scale, spanLayers: number): Array<{ polygons: Polygon2D[]; groundM: number }> {
  const window = boundsOf(polygons);
  const local = layers.map((layer) => windowPolygons(layer.polygons, window));
  let top = 0;
  while (top + 1 < layers.length && clipPolygons(polygons, local[top + 1]!, "intersection").length) top += 1;
  const bands: Array<{ polygons: Polygon2D[]; groundM: number }> = [];
  for (let low = 0; low <= top; low += spanLayers) {
    const high = Math.min(low + spanLayers - 1, top);
    const within = low === 0 ? polygons : clipPolygons(polygons, local[low]!, "intersection");
    const band = high < top ? clipPolygons(within, local[high + 1]!, "difference") : within;
    if (band.length) bands.push({ polygons: band, groundM: scale.baseM + (layers[high]!.index + 1) * scale.metersPerLayer - scale.metersPerLayer });
  }
  return bands;
}

/** Resolve one sector's limits; floors and ceilings given above ground are split into terraces over the terrain. */
function resolveParts(volume: AirspaceVolumeV1, polygons: Polygon2D[], settings: AirspaceStackSettingsV1, capM: number, layers: LayerIR[], scale: Scale, spanLayers: number): Part[] {
  const isLid = volume.aviationClass === "class-d";
  const fixed = (altitude: AirspaceVolumeV1["ceiling"]) => (altitude.ref === "msl" || altitude.ref === "fl" ? altitude.ft * FEET : undefined);
  const ceilingFixed = volume.ceiling.ref === "unlimited" ? capM : fixed(volume.ceiling);
  // Tiers give a sector that starts at the surface a floor just above the ground, as one 0 ft above it.
  const surfaceFloor = volume.floor.ref === "sfc" && settings.form === "tiers" && !isLid;
  const floorFromGround = volume.floor.ref === "agl" || surfaceFloor;
  const ceilingFromGround = volume.ceiling.ref === "agl";
  const make = (area: Polygon2D[], floorM: number | null, ceilingM: number, fromGround: boolean): Part[] => {
    const ceiling = Math.min(ceilingM, capM);
    if (floorM !== null && floorM >= ceiling) return [];
    return [{ volume, polygons: area, floorM, ceilingM: ceiling, floorFromGround: fromGround && floorFromGround, ceilingFromGround: fromGround && ceilingFromGround }];
  };
  if (!floorFromGround && !ceilingFromGround) {
    const floorM = volume.floor.ref === "sfc" ? null : fixed(volume.floor)!;
    return make(polygons, floorM, ceilingFixed!, false);
  }
  const floorAbove = volume.floor.ref === "agl" ? volume.floor.ft * FEET : 0;
  const ceilingAbove = volume.ceiling.ref === "agl" ? volume.ceiling.ft * FEET : 0;
  return groundBands(polygons, layers, scale, spanLayers).flatMap((band) => make(
    band.polygons,
    floorFromGround ? band.groundM + floorAbove : volume.floor.ref === "sfc" ? null : fixed(volume.floor)!,
    ceilingFromGround ? band.groundM + ceilingAbove : ceilingFixed!,
    true,
  ));
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
    if (part.ceilingFromGround && !ordered().some((altitude) => altitude >= part.ceilingM)) fixed.add(part.ceilingM);
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

function edgesWithin(parts: Part[], piece: Polygon2D[]): AirspaceEdgeIR[] {
  return parts.flatMap((part) => part.polygons.flatMap((polygon) => [polygon.outer, ...polygon.holes]).flatMap((ring) =>
    clipPolyline(ring, piece).filter((points) => points.length >= 2).map((points): AirspaceEdgeIR => ({ aviationClass: part.volume.aviationClass, points }))));
}

interface Builder {
  config: ProjectConfigV1;
  layers: LayerIR[];
  scale: Scale;
  thicknessMm: number;
  dropped: { count: number };
  clearance: Map<number, Polygon2D[]>;
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
  let outline = closed(union(polygons), config.minimumFeatureMm);
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

function stepLevels(builder: Builder, parts: Part[], altitudes: number[][], snap: (altitudeM: number) => number, form: "plates" | "tiers"): AirspaceLevelIR[] {
  const { scale } = builder;
  const levels: AirspaceLevelIR[] = [];
  for (const group of altitudes) {
    const altitude = group[0]!;
    const zMm = scale.z(altitude);
    if (zMm < scale.thicknessMm) continue; // below the land: nothing to hold in the air
    const floors = parts.filter((part) => part.floorM !== null && snap(part.floorM) === altitude && part.volume.aviationClass !== "class-d");
    const ceilings = parts.filter((part) => snap(part.ceilingM) === altitude);
    const through = parts.filter((part) => part.volume.aviationClass !== "class-d" && (part.floorM === null || snap(part.floorM) < altitude) && snap(part.ceilingM) > altitude);
    const index = levels.length;
    const pieces: AirspacePieceIR[] = [];
    if (form === "plates") {
      const members = [...floors, ...ceilings, ...through];
      const outline = pieceOutline(builder, members.flatMap((part) => part.polygons), zMm);
      outline.forEach((polygon, n) => {
        const own = [polygon];
        const shelves = [...floors, ...ceilings];
        const frost = shelves.length ? clipPolygons(closed(union(shelves.flatMap((part) => part.polygons)), builder.config.minimumFeatureMm), own, "intersection") : [];
        pieces.push(piece(`A${index + 1}-${n + 1}`, "clear", own, members.filter((part) => clipPolygons(part.polygons, own, "intersection").length), {
          frost: normalizedPolygons(frost, builder.config.minimumFeatureMm),
          edges: edgesWithin(through, own),
        }));
      });
    } else {
      for (const tint of ["blue", "magenta"] as const) {
        const members = [...floors, ...ceilings].filter((part) => airspaceTint(part.volume) === tint);
        if (!members.length) continue;
        for (const polygon of pieceOutline(builder, members.flatMap((part) => part.polygons), zMm)) {
          pieces.push(piece(`A${index + 1}-${pieces.length + 1}`, tint, [polygon], members.filter((part) => clipPolygons(part.polygons, [polygon], "intersection").length)));
        }
      }
    }
    if (pieces.length) levels.push({ index, altitudeFt: Math.round(altitude / FEET), mergedFt: group.slice(1).map((value) => Math.round(value / FEET)), zMm, pieces });
  }
  return levels.map((level, index) => index === level.index ? level : renumber(level, index));
}

function renumber(level: AirspaceLevelIR, index: number): AirspaceLevelIR {
  return { ...level, index, pieces: level.pieces.map((entry) => ({ ...entry, id: entry.id.replace(/^A\d+-/, `A${index + 1}-`) })) };
}

/** Volumes: every acrylic sheet from the lowest floor to the highest ceiling, stacked; Class D stays a lid at its ceiling. */
function sliceLevels(builder: Builder, parts: Part[]): AirspaceLevelIR[] {
  const { scale, thicknessMm } = builder;
  const solid = parts.filter((part) => part.volume.aviationClass !== "class-d");
  const lids = parts.filter((part) => part.volume.aviationClass === "class-d");
  const levels: AirspaceLevelIR[] = [];
  if (solid.length) {
    const bottom = Math.max(scale.thicknessMm, Math.min(...solid.map((part) => (part.floorM === null ? scale.thicknessMm : scale.z(part.floorM)))));
    const top = Math.max(...solid.map((part) => scale.z(part.ceilingM)));
    for (let zMm = bottom; zMm < top - 1e-6; zMm += thicknessMm) {
      const altitude = scale.baseM + (zMm - scale.thicknessMm) / scale.mmPerMeter;
      const index = levels.length;
      const pieces: AirspacePieceIR[] = [];
      for (const tint of ["blue", "magenta"] as const) {
        // A sheet belongs to a sector when its middle lies between the floor and the ceiling.
        const middle = altitude + thicknessMm / 2 / scale.mmPerMeter;
        const members = solid.filter((part) => airspaceTint(part.volume) === tint && (part.floorM === null || part.floorM <= middle) && part.ceilingM > middle);
        if (!members.length) continue;
        for (const polygon of pieceOutline(builder, members.flatMap((part) => part.polygons), zMm)) {
          pieces.push(piece(`A${index + 1}-${pieces.length + 1}`, tint, [polygon], members));
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
    const pieces = pieceOutline(builder, members.flatMap((part) => part.polygons), zMm).map((polygon, n) => piece(`A${index + 1}-${n + 1}`, "blue", [polygon], members));
    if (pieces.length) levels.push({ index, altitudeFt: Math.round(ceiling / FEET), mergedFt: [], zMm, pieces });
  }
  return levels.sort((a, b) => a.zMm - b.zMm).map((level, index) => renumber(level, index));
}

/**
 * The airspace stack for a layered model, or undefined when the project does
 * not ask for one. Runs on the unsplit sheets after water inserts are cut, so
 * every hole a later stage adds to a sheet is already known.
 */
export function buildAirspaceStack(config: ProjectConfigV1, source: SourceBundleV1, layers: LayerIR[], ladder: ElevationLadder, clip: Point2D[], warnings: GeometryWarning[]): AirspaceStackIR | undefined {
  const settings = config.airspaceStack;
  const material = airspaceMaterial(config);
  if (!settings || !material) return undefined;
  if (!source.airspaceVolumes) {
    warnings.push({ code: "AIRSPACE_NOT_LOADED", message: "Airspace was not loaded for this area, so no airspace pieces were made. Airspace data covers the US and its territories." });
    return undefined;
  }
  const t = config.materialThicknessMm;
  const metersPerLayer = ladder.stack.metersPerLayer;
  const scale: Scale = {
    thicknessMm: t, baseM: ladder.ladderBase, metersPerLayer, mmPerMeter: t / metersPerLayer,
    z: (altitudeM) => t + ((altitudeM - ladder.ladderBase) / metersPerLayer) * t,
  };
  const gapMm = material.thicknessMm + AIRSPACE_LEVEL_ROOM_MM;
  const crop: Polygon2D[] = [{ outer: clip, holes: [] }];
  const volumes = source.airspaceVolumes.filter((volume) => classEnabled(volume, settings.classes));
  const charted = volumes
    .filter((volume) => volume.aviationClass === "class-b" || volume.aviationClass === "class-c")
    .flatMap((volume) => (volume.ceiling.ref === "msl" || volume.ceiling.ref === "fl" ? [volume.ceiling.ft] : []));
  const ceilingCapFt = settings.ceilingCapFt ?? (charted.length ? Math.max(...charted) : AIRSPACE_DEFAULT_CAP_FT);
  const spanLayers = Math.max(1, Math.floor(gapMm / t));
  let parts = volumes.flatMap((volume) => {
    const inside = clipPolygons(volume.polygons, crop, "intersection");
    return inside.length ? resolveParts(volume, inside, settings, ceilingCapFt * FEET, layers, scale, spanLayers) : [];
  });
  // A floor below the land stands on the ground; a part whose ceiling is below it is underground.
  parts = parts
    .map((part) => (part.floorM !== null && !part.floorFromGround && scale.z(part.floorM) <= t ? { ...part, floorM: null } : part))
    .filter((part) => scale.z(part.ceilingM) > t);
  const terraced = new Set(parts.filter((part) => part.floorFromGround || part.ceilingFromGround).map((part) => part.volume.id));
  const builder: Builder = { config, layers, scale, thicknessMm: material.thicknessMm, dropped: { count: 0 }, clearance: new Map() };
  let levels: AirspaceLevelIR[];
  if (settings.form === "volumes") {
    levels = sliceLevels(builder, parts);
  } else {
    const { altitudes, snap } = levelsOf(parts, scale, gapMm);
    levels = stepLevels(builder, parts, altitudes, snap, settings.form);
    const merged = altitudes.filter((group) => group.length > 1);
    if (merged.length) warnings.push({
      code: "AIRSPACE_LEVELS_MERGED",
      message: `${merged.length} airspace ${merged.length === 1 ? "level was" : "levels were"} merged into the level below, because no rod fits between pieces closer than ${gapMm.toFixed(1)} mm. Raise Vertical exaggeration to separate them.`,
    });
  }
  const terracedNames = [...new Set(parts.filter((part) => terraced.has(part.volume.id) && part.volume.floor.ref === "agl").map((part) => part.volume.name))];
  if (terracedNames.length) warnings.push({
    code: "AIRSPACE_TERRACED",
    message: `${terracedNames.slice(0, 3).join(", ")}${terracedNames.length > 3 ? ` and ${terracedNames.length - 3} more` : ""} ${terracedNames.length === 1 ? "has" : "have"} a floor given above ground, built as steps over the terrain.`,
  });
  if (builder.dropped.count) warnings.push({
    code: "AIRSPACE_PIECES_DROPPED",
    message: `${builder.dropped.count} airspace ${builder.dropped.count === 1 ? "piece was" : "pieces were"} left out because ${builder.dropped.count === 1 ? "it was" : "they were"} smaller than 10 cm² after the terrain and the crop cut ${builder.dropped.count === 1 ? "it" : "them"}.`,
  });
  const topMm = levels.length ? Math.max(...levels.map((level) => level.zMm + material.thicknessMm)) : 0;
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
  return { form: settings.form, thicknessMm: material.thicknessMm, kerfMm: material.kerfMm, ceilingCapFt, mmPerMeter: scale.mmPerMeter, topMm, levels, rod: { ...settings.rod } };
}
