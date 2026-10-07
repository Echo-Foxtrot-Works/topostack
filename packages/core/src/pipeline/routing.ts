import { layerForElevation, sampleElevation } from "./contours.js";
import { coordinateGridMarkings } from "./coordinate-grid.js";
import { fabricationLabel, junctionRing, longestPath, styledTransportationPaths, transportationJunctions, transportationOutlines } from "./transportation.js";
import { clipPolyline, polylineLength, pointInPreparedPolygons, type PreparedPolygons, preparePolygons } from "../primitives/geometry2d.js";
import { placeLinearLabel } from "../annotate/label-placement.js";
import { geoPointToMapPoint } from "../annotate/markers.js";
import { offsetPolygons } from "../primitives/offset.js";
import { WATER_INSERT_SHORE_BAND_MM } from "./water-inserts.js";
import type { ElevationGrid, LayerIR, MarkingFeature, Point2D, Polygon2D, ProjectConfigV1, TransportationClass, WaterInsertIR } from "../types.js";
import type { ElevationLadder, GenerationContext } from "./generation-context.js";
import type { LayerClip } from "./layer-clips.js";

const TRANSPORTATION_LABEL_LIMIT = 80;

function isClosedWater(feature: MarkingFeature): boolean {
  return feature.kind === "water" && feature.points.length > 3 && Math.hypot(feature.points[0]!.x - feature.points.at(-1)!.x, feature.points[0]!.y - feature.points.at(-1)!.y) <= 1e-6;
}

function splitMarking(feature: MarkingFeature, thresholds: number[], grid: ElevationGrid, config: ProjectConfigV1): Array<{ layer: number; points: Point2D[] }> {
  if (isClosedWater(feature)) {
    const elevations = feature.points.slice(0, -1).map((point) => feature.elevationM ?? sampleElevation(grid, point, config)).sort((left, right) => left - right);
    const middle = Math.floor(elevations.length / 2);
    const elevation = elevations.length % 2 === 0 ? ((elevations[middle - 1] ?? grid.min) + (elevations[middle] ?? grid.min)) / 2 : (elevations[middle] ?? grid.min);
    return [{ layer: layerForElevation(elevation, thresholds), points: feature.points }];
  }
  const result: Array<{ layer: number; points: Point2D[] }> = [];
  // A single-point feature (e.g. a point label) still belongs to a layer even
  // though it produces no drawable segment.
  const minimumRun = feature.points.length === 1 ? 1 : 2;
  let activeLayer = -1;
  let active: Point2D[] = [];
  for (const point of feature.points) {
    const elevation = feature.elevationM ?? sampleElevation(grid, point, config);
    const layer = layerForElevation(elevation, thresholds);
    if (layer !== activeLayer) {
      if (active.length >= minimumRun && activeLayer >= 0) result.push({ layer: activeLayer, points: active });
      activeLayer = layer;
      active = active.length ? [active[active.length - 1]!, point] : [point];
    } else {
      active.push(point);
    }
  }
  if (active.length >= minimumRun && activeLayer >= 0) result.push({ layer: activeLayer, points: active });
  return result;
}

interface TransportationLabelCandidate {
  layer: LayerIR;
  paths: Point2D[][];
  transportationClass: TransportationClass;
  excludedPolygons: Polygon2D[];
}

/** Every visible clipped run of each distinct road or trail name. */
export type TransportationLabelCandidates = Map<string, TransportationLabelCandidate[]>;

function transportationClassOf(feature: MarkingFeature): TransportationClass | undefined {
  return feature.transportationClass ?? (feature.kind === "trail" ? "trail" : feature.kind === "road" ? "local-road" : undefined);
}

export function markingEnabled(feature: MarkingFeature, config: ProjectConfigV1): boolean {
  const transportationClass = transportationClassOf(feature);
  return feature.id.startsWith("custom-data-line-") ||
    (transportationClass === "trail" && config.showTrails) ||
    (transportationClass !== undefined && transportationClass !== "trail" && config.showRoads) ||
    (feature.kind === "water" && config.showWater) ||
    (feature.kind === "boundary" && config.showBoundaries) ||
    (feature.kind === "grid" && config.showCoordinateGrid) ||
    // Aviation lines are filtered by class when they are built (aviationFeatures).
    feature.kind === "aviation" ||
    feature.kind === "contour" || feature.kind === "label" || feature.kind === "guide";
}

/** Source, custom, and graticule features with their ids made unique among repeated source ids. */
function mapFeatures(context: GenerationContext, modelGrid: ElevationGrid): Array<{ feature: MarkingFeature; featureId: string }> {
  const { config, source } = context;
  const customLineMarkings: MarkingFeature[] = config.customLines.map((line, index) => ({
    id: `custom-data-line-${index}`,
    kind: line.kind,
    operation: "engrave",
    points: line.points.map((point) => geoPointToMapPoint(point.lat, point.lon, source.bounds, config.widthMm, config.heightMm)),
    ...(line.kind === "trail" ? { transportationClass: "trail" as const } : {}),
  }));
  const mapMarkings = [
    ...source.markings,
    ...context.aviation.lines,
    ...customLineMarkings,
    ...(config.showCoordinateGrid ? coordinateGridMarkings(config, source.bounds, modelGrid) : []),
  ];
  const sourceIdCounts = new Map<string, number>();
  mapMarkings.forEach((feature) => sourceIdCounts.set(feature.id, (sourceIdCounts.get(feature.id) ?? 0) + 1));
  const sourceIdOccurrences = new Map<string, number>();
  return mapMarkings.map((feature) => {
    const sourceOccurrence = sourceIdOccurrences.get(feature.id) ?? 0;
    sourceIdOccurrences.set(feature.id, sourceOccurrence + 1);
    return { feature, featureId: (sourceIdCounts.get(feature.id) ?? 0) > 1 ? `${feature.id}-source-${sourceOccurrence}` : feature.id };
  });
}

function addTransportationLabelCandidate(labels: TransportationLabelCandidates, label: string, candidate: TransportationLabelCandidate): void {
  const candidates = labels.get(label);
  if (candidates) candidates.push(candidate);
  else labels.set(label, [candidate]);
}

/** A flat engraving has one physical face, so every feature is clipped to the crop once. */
function routeFlatMarking(config: ProjectConfigV1, feature: MarkingFeature, featureId: string, base: LayerClip, labels: TransportationLabelCandidates): void {
  const { layer: baseLayer, material: baseMaterial } = base;
  const transportationClass = transportationClassOf(feature);
  if (transportationClass) {
    const clipped = clipPolyline(feature.points, baseMaterial);
    styledTransportationPaths(transportationOutlines(feature.points, transportationClass, config), clipped, baseMaterial).forEach((points, styleIndex) => baseLayer.markings.push({
      id: `${featureId}-flat-transport-${styleIndex}`,
      operation: "engrave",
      kind: transportationClass === "trail" ? "trail" : "road",
      transportationClass,
      points,
    }));
    const label = feature.label && config.showTransportationLabels ? fabricationLabel(feature.label, config.textStyle.font) : undefined;
    if (label && clipped.length) addTransportationLabelCandidate(labels, label, { layer: baseLayer, paths: clipped, transportationClass, excludedPolygons: [] });
    return;
  }
  if (feature.label && feature.points[0] && pointInPreparedPolygons(feature.points[0], baseMaterial)) {
    baseLayer.markings.push({ id: `${featureId}-flat-label`, operation: feature.operation, kind: feature.kind, points: [feature.points[0]], label: feature.label, textStyle: config.textStyle });
  }
  clipPolyline(feature.points, baseMaterial)
    .filter((points) => feature.kind !== "water" || polylineLength(points) >= config.minimumFeatureMm)
    .forEach((points, clipIndex) => baseLayer.markings.push({ id: `${featureId}-flat-${clipIndex}`, operation: feature.operation, kind: feature.kind, ...(feature.aviationClass ? { aviationClass: feature.aviationClass } : {}), points }));
}

function routeStackMarking(config: ProjectConfigV1, feature: MarkingFeature, featureId: string, clips: LayerClip[], ladder: ElevationLadder, labels: TransportationLabelCandidates, excluded?: PreparedPolygons): void {
  const layers = clips.map(({ layer }) => layer);
  const transportationClass = transportationClassOf(feature);
  if (transportationClass) {
    const outlines = transportationOutlines(feature.points, transportationClass, config);
    const label = feature.label && config.showTransportationLabels ? fabricationLabel(feature.label, config.textStyle.font) : undefined;
    clips.forEach(({ layer, material, covering }) => {
      const clipped = clipPolyline(feature.points, material, covering);
      styledTransportationPaths(outlines, clipped, material, covering).forEach((points, styleIndex) => layer.markings.push({
        id: `${featureId}-${layer.index}-transport-${styleIndex}`,
        operation: "engrave",
        kind: transportationClass === "trail" ? "trail" : "road",
        transportationClass,
        points,
      }));
      if (label && clipped.length) addTransportationLabelCandidate(labels, label, { layer, paths: clipped, transportationClass, excludedPolygons: covering.polygons });
    });
    return;
  }
  // Terrain boundaries, grids, and open waterways follow every exposed layer.
  // Assigning them from elevations sampled only at their source vertices can
  // skip every intermediate layer when a coarse segment crosses a contour,
  // leaving the score line visibly short of the step edge. Clipping the full
  // path against each exposed layer footprint makes adjacent pieces meet at
  // the exact contour intersection, independent of source vertex spacing.
  // Aviation detail lies on the ground wherever it is, so it takes the same path.
  if ((feature.kind === "boundary" || feature.kind === "grid" || feature.kind === "aviation" || (feature.kind === "water" && !isClosedWater(feature))) && feature.elevationM === undefined) {
    clips.forEach(({ layer, material, covering }) => {
      clipPolyline(feature.points, material, covering).forEach((points, clipIndex) => layer.markings.push({
        id: `${featureId}-${layer.index}-terrain-${clipIndex}`,
        operation: feature.operation,
        kind: feature.kind,
        ...(feature.aviationClass ? { aviationClass: feature.aviationClass } : {}),
        points,
      }));
    });
    // Keep the existing elevation-based label behavior while the line itself
    // follows the exact layer contours. Explicit-elevation water features use
    // the legacy path below because they intentionally belong to one plane.
    if (feature.label) {
      for (const [segmentIndex, segment] of splitMarking(feature, ladder.thresholds, ladder.modelGrid, config).entries()) {
        const layer = layers[segment.layer];
        if (layer && segment.points[0] && pointInPreparedPolygons(segment.points[0], clips[segment.layer]!.material)) {
          layer.markings.push({ id: `${featureId}-${layer.index}-${segmentIndex}-label`, operation: feature.operation, kind: feature.kind, points: [segment.points[0]], label: feature.label, textStyle: config.textStyle });
        }
      }
    }
    return;
  }
  for (const [segmentIndex, segment] of splitMarking(feature, ladder.thresholds, ladder.modelGrid, config).entries()) {
    const layer = layers[segment.layer];
    if (!layer) continue;
    const material = clips[segment.layer]!.material;
    const clipped = clipPolyline(segment.points, material, excluded);
    if (feature.label && segment.points[0] && pointInPreparedPolygons(segment.points[0], material)) {
      layer.markings.push({ id: `${featureId}-${layer.index}-${segmentIndex}-label`, operation: feature.operation, kind: feature.kind, points: [segment.points[0]], label: feature.label, textStyle: config.textStyle });
    }
    clipped.filter((points) => feature.kind !== "water" || polylineLength(points) >= config.minimumFeatureMm).forEach((points, clipIndex) => layer.markings.push({
      id: `${featureId}-${layer.index}-${segmentIndex}-${clipIndex}`,
      operation: feature.operation,
      kind: feature.kind,
      points,
    }));
  }
}

/**
 * Where the shoreline score rings of lakes that became acrylic must not run:
 * over the acrylic and a hair past its edge. A ring there would follow the
 * cut that opens the lake, half on the wood and half on the insert; the
 * stretches along arms that stayed wood keep their score. The rings are the
 * lake's own outline rings (`smoothLakeShorelines` shares them), so identity
 * answers for a real source; a copied ring is matched by value.
 */
export function insertedShorelines({ source }: GenerationContext, inserts: WaterInsertIR[]): (feature: MarkingFeature) => PreparedPolygons | undefined {
  if (!inserts.length) return () => undefined;
  const surfaceIds = new Set(inserts.map((insert) => insert.surfaceId));
  const rings = (source.waterAreas ?? []).filter((area) => surfaceIds.has(area.id)).flatMap((area) => [area.polygon.outer, ...area.polygon.holes]);
  const byIdentity = new Set<Point2D[]>(rings);
  let byValue: Set<string> | undefined;
  let band: PreparedPolygons | undefined;
  return (feature) => {
    if (!isClosedWater(feature)) return undefined;
    if (!byIdentity.has(feature.points)) {
      byValue ??= new Set(rings.map((ring) => JSON.stringify(ring)));
      if (!byValue.has(JSON.stringify(feature.points))) return undefined;
    }
    return band ??= preparePolygons(offsetPolygons(inserts.flatMap((insert) => insert.polygons), WATER_INSERT_SHORE_BAND_MM, "round"));
  };
}

/** Route every enabled map feature onto the layers it is visible on; returns transportation label candidates. */
export function routeMarkings(context: GenerationContext, clips: LayerClip[], ladder: ElevationLadder, excludedFor: (feature: MarkingFeature) => PreparedPolygons | undefined = () => undefined): TransportationLabelCandidates {
  const { config, source, flatEngraving } = context;
  const labels: TransportationLabelCandidates = new Map();
  for (const { feature, featureId } of mapFeatures(context, ladder.modelGrid)) {
    if (!markingEnabled(feature, config)) continue;
    // Routing every feature through every elevation band of a flat engraving
    // only explodes one road into dozens of DOM/SVG paths before reassembling it.
    if (flatEngraving) routeFlatMarking(config, feature, featureId, clips[0]!, labels);
    else routeStackMarking(config, feature, featureId, clips, ladder, labels, excludedFor(feature));
  }

  const enabledRoadFeatures = source.markings.filter((feature) => feature.kind === "road" && config.showRoads);
  const roadJunctions = config.lineStyle.roadStyle === "outlined" ? transportationJunctions(enabledRoadFeatures) : [];
  roadJunctions.forEach((junction, junctionIndex) => {
    const ring = junctionRing(junction.point, config.lineStyle.majorRoadSpacingMm / 2);
    (flatEngraving ? clips.slice(0, 1) : clips).forEach(({ layer, material, covering }) => {
      clipPolyline(ring, material, flatEngraving ? undefined : covering).forEach((points, clipIndex) => layer.markings.push({
        id: `road-junction-${junctionIndex}-${layer.index}-${clipIndex}`,
        operation: "engrave",
        kind: "road",
        transportationClass: "major-road",
        points,
      }));
    });
  });
  return labels;
}

export function placeTransportationLabels(config: ProjectConfigV1, labels: TransportationLabelCandidates): number {
  let transportationLabelIndex = 0;
  const labelEntries = [...labels].map(([label, candidates]) => {
    const lengths = candidates.map((candidate) => ({ candidate, length: longestPath(candidate.paths) }));
    return { label, lengths, longest: lengths.reduce((best, { length }) => Math.max(best, length), Number.NEGATIVE_INFINITY) };
  }).sort((left, right) => right.longest - left.longest || left.label.localeCompare(right.label)).slice(0, TRANSPORTATION_LABEL_LIMIT);
  for (const { label, lengths } of labelEntries) {
    const ordered = lengths.sort((left, right) => right.length - left.length).map(({ candidate }) => candidate);
    for (const candidate of ordered) {
      const placement = placeLinearLabel(label, config, candidate.layer, candidate.paths, candidate.excludedPolygons);
      if (!placement) continue;
      candidate.layer.markings.push({
        id: `transport-label-${transportationLabelIndex++}`,
        operation: "engrave",
        kind: "label",
        transportationClass: candidate.transportationClass,
        points: [placement.point],
        label,
        labelRotationRad: placement.rotationRad,
        textStyle: config.textStyle,
      });
      break;
    }
  }
  return transportationLabelIndex;
}
