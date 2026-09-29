import { DEFAULT_AVIATION_MM, type AviationSymbol, type AviationSymbolDetail, type Point2D } from "../types.js";

/**
 * Aviation symbols drawn after the VFR sectional legend in the FAA Aeronautical
 * Chart Users' Guide, for a single engraving colour. Where the chart relies on
 * colour (blue towered fields, magenta others) the shape is the same; where it
 * fills a shape (hard-surfaced airport discs, VORTAC tabs) the fill is hatched
 * at the stroke width so it engraves solid. Closed rings repeat their first point.
 *
 * Airports and navaids are centered on their position. Obstacles stand on it:
 * the dot at the foot of the symbol is the obstacle, as on the chart.
 */

type Path = Point2D[];

const at = (center: Point2D, x: number, y: number): Point2D => ({ x: center.x + x, y: center.y + y });

function ring(center: Point2D, radius: number, sides: number, rotation = 0): Path {
  const points = Array.from({ length: sides }, (_, index) => {
    const angle = rotation + (index / sides) * Math.PI * 2;
    return at(center, Math.cos(angle) * radius, Math.sin(angle) * radius);
  });
  return [...points, { ...points[0]! }];
}

const circle = (center: Point2D, radius: number) => ring(center, radius, 32);

/** A tiny closed square: one engraved dot that survives any laser's minimum segment. */
const dot = (center: Point2D, radius: number): Path => ring(center, radius, 4, Math.PI / 4);

/** A hexagon with points left and right and flat top and bottom, as the VOR is charted. */
const hexagon = (center: Point2D, radius: number): Path => ring(center, radius, 6);

function rectangle(center: Point2D, halfWidth: number, halfHeight: number): Path {
  return [at(center, -halfWidth, -halfHeight), at(center, halfWidth, -halfHeight), at(center, halfWidth, halfHeight), at(center, -halfWidth, halfHeight), at(center, -halfWidth, -halfHeight)];
}

function star(center: Point2D, radius: number): Path {
  const points = Array.from({ length: 10 }, (_, index) => {
    const angle = -Math.PI / 2 + (index / 10) * Math.PI * 2;
    const r = index % 2 ? radius * 0.4 : radius;
    return at(center, Math.cos(angle) * r, Math.sin(angle) * r);
  });
  return [...points, { ...points[0]! }];
}

/** Fuel ticks at the four compass points of an airport circle, skipping north when a beacon star sits there. */
function ticks(center: Point2D, inner: number, outer: number, skipNorth: boolean): Path[] {
  return [0, 1, 2, 3].filter((index) => !(skipNorth && index === 3)).map((index) => {
    const angle = (index / 4) * Math.PI * 2;
    return [at(center, Math.cos(angle) * inner, Math.sin(angle) * inner), at(center, Math.cos(angle) * outer, Math.sin(angle) * outer)];
  });
}

/** Where a horizontal line at `y` is inside `polygon` (even-odd), as sorted [start, end] spans. */
function spans(polygon: Path, y: number): Array<[number, number]> {
  const crossings: number[] = [];
  for (let index = 0; index < polygon.length - 1; index += 1) {
    const a = polygon[index]!;
    const b = polygon[index + 1]!;
    if ((a.y <= y) !== (b.y <= y)) crossings.push(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
  }
  crossings.sort((left, right) => left - right);
  const result: Array<[number, number]> = [];
  for (let index = 0; index + 1 < crossings.length; index += 2) result.push([crossings[index]!, crossings[index + 1]!]);
  return result;
}

function subtract(from: Array<[number, number]>, cut: Array<[number, number]>): Array<[number, number]> {
  let result = from;
  for (const [cutStart, cutEnd] of cut) {
    result = result.flatMap(([start, end]): Array<[number, number]> => {
      if (cutEnd <= start || cutStart >= end) return [[start, end]];
      return [...(cutStart > start ? [[start, cutStart] as [number, number]] : []), ...(cutEnd < end ? [[cutEnd, end] as [number, number]] : [])];
    });
  }
  return result;
}

/**
 * Hatch lines that engrave `polygon` solid, less the `knockouts`. Lines are
 * spaced a little under one stroke apart so neighbours overlap.
 */
function fill(polygon: Path, strokeMm: number, knockouts: Path[] = []): Path[] {
  const spacing = strokeMm * 0.8;
  const ys = polygon.map((point) => point.y);
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  const lines: Path[] = [];
  for (let y = top + spacing / 2; y < bottom; y += spacing) {
    const cut = knockouts.flatMap((knockout) => spans(knockout, y)).sort((left, right) => left[0] - right[0]);
    for (const [start, end] of subtract(spans(polygon, y), cut)) {
      if (end - start > 1e-6) lines.push([{ x: start, y }, { x: end, y }]);
    }
  }
  return lines;
}

/** A filled shape: its outline, inset half a stroke so the engraved edge lands on the shape, and its hatch. */
function solid(polygon: (inset: number) => Path, strokeMm: number, knockouts: Path[] = []): Path[] {
  const outline = polygon(strokeMm / 2);
  return [outline, ...fill(outline, strokeMm, knockouts)];
}

/** Runway centerlines centered and scaled so every end lies within `radius` of `center`. */
function fitRunways(runways: Path[], center: Point2D, radius: number): Array<[Point2D, Point2D]> {
  const segments = runways.filter((runway) => runway.length >= 2).map((runway) => [runway[0]!, runway.at(-1)!] as [Point2D, Point2D]);
  const points = segments.flat();
  if (!points.length) return [];
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const middle = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  const extent = Math.max(...points.map((point) => Math.hypot(point.x - middle.x, point.y - middle.y)));
  if (!(extent > 0)) return [];
  const scale = radius / extent;
  const place = (point: Point2D) => at(center, (point.x - middle.x) * scale, (point.y - middle.y) * scale);
  return segments.map(([start, end]) => [place(start), place(end)]);
}

/** The strip a runway covers, `halfWidth` either side of its centerline, as a closed ring. */
function strip([start, end]: [Point2D, Point2D], halfWidth: number): Path {
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const normal = { x: -(end.y - start.y) / length * halfWidth, y: (end.x - start.x) / length * halfWidth };
  const corners = [
    { x: start.x + normal.x, y: start.y + normal.y }, { x: end.x + normal.x, y: end.y + normal.y },
    { x: end.x - normal.x, y: end.y - normal.y }, { x: start.x - normal.x, y: start.y - normal.y },
  ];
  return [...corners, { ...corners[0]! }];
}

/** Parameters along a->b where the segment lies strictly inside the convex ring `polygon`. */
function insideInterval(a: Point2D, b: Point2D, polygon: Path): [number, number] | undefined {
  let [low, high] = [0, 1];
  const area = polygon.slice(0, -1).reduce((sum, point, index) => sum + point.x * polygon[index + 1]!.y - polygon[index + 1]!.x * point.y, 0);
  const sign = area > 0 ? 1 : -1;
  for (let index = 0; index < polygon.length - 1; index += 1) {
    const p = polygon[index]!;
    const q = polygon[index + 1]!;
    const side = (point: Point2D) => sign * ((q.x - p.x) * (point.y - p.y) - (q.y - p.y) * (point.x - p.x));
    const [sa, sb] = [side(a), side(b)];
    if (sa <= 1e-9 && sb <= 1e-9) return undefined;
    if (sa < 0 || sb < 0) {
      const t = sa / (sa - sb);
      if (sa < 0) low = Math.max(low, t); else high = Math.min(high, t);
    }
  }
  return high - low > 1e-9 ? [low, high] : undefined;
}

/** The outline of overlapping runway strips as one shape: each edge less whatever runs inside another strip. */
function unionOutline(strips: Path[]): Path[] {
  const paths: Path[] = [];
  strips.forEach((own, stripIndex) => {
    for (let index = 0; index < own.length - 1; index += 1) {
      const a = own[index]!;
      const b = own[index + 1]!;
      const hidden = strips.flatMap((other, otherIndex) => {
        const interval = otherIndex === stripIndex ? undefined : insideInterval(a, b, other);
        return interval ? [interval] : [];
      }).sort((left, right) => left[0] - right[0]);
      for (const [start, end] of subtract([[0, 1]], hidden)) {
        const point = (t: number) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        paths.push([point(start), point(end)]);
      }
    }
  });
  return paths;
}

/** The letter R, `height` tall, for private fields. */
function letterR(center: Point2D, height: number): Path[] {
  const h = height / 2;
  const bowl = Array.from({ length: 9 }, (_, index) => {
    const angle = -Math.PI / 2 + (index / 8) * Math.PI;
    return at(center, h * 0.1 + Math.cos(angle) * h * 0.5, -h * 0.5 + Math.sin(angle) * h * 0.5);
  });
  return [
    [at(center, -h * 0.5, h), at(center, -h * 0.5, -h), ...bowl, at(center, -h * 0.5, 0)],
    [at(center, h * 0.05, 0), at(center, h * 0.55, h)],
  ];
}

function letterH(center: Point2D, height: number): Path[] {
  const h = height / 2;
  return [[at(center, -h * 0.6, -h), at(center, -h * 0.6, h)], [at(center, h * 0.6, -h), at(center, h * 0.6, h)], [at(center, -h * 0.6, 0), at(center, h * 0.6, 0)]];
}

/** The seaplane base anchor, `height` tall. */
function seaplaneAnchor(center: Point2D, height: number): Path[] {
  const h = height;
  const arm = Array.from({ length: 13 }, (_, index) => {
    const angle = (20 + (index / 12) * 140) * Math.PI / 180;
    return at(center, Math.cos(angle) * h * 0.4, h * 0.06 + Math.sin(angle) * h * 0.4);
  });
  const [right, left] = [arm[0]!, arm.at(-1)!];
  return [
    ring(at(center, 0, -h * 0.4), h * 0.08, 12),
    [at(center, 0, -h * 0.32), at(center, 0, h * 0.46)],
    [at(center, -h * 0.18, -h * 0.2), at(center, h * 0.18, -h * 0.2)],
    arm,
    [right, { x: right.x + h * 0.02, y: right.y - h * 0.13 }],
    [left, { x: left.x - h * 0.02, y: left.y - h * 0.13 }],
  ];
}

/**
 * The corners of each hexagon side and of the tab standing on it. Sides are
 * numbered from the right point clockwise (y down): 1 is the bottom, 3 upper
 * left, 5 upper right, which is where the VORTAC and TACAN carry their tabs.
 */
function hexagonSide(center: Point2D, radius: number, side: number, depth: number) {
  const a0 = (side / 6) * Math.PI * 2;
  const a1 = ((side + 1) / 6) * Math.PI * 2;
  const normal = (a0 + a1) / 2;
  const inner0 = at(center, Math.cos(a0) * radius, Math.sin(a0) * radius);
  const inner1 = at(center, Math.cos(a1) * radius, Math.sin(a1) * radius);
  const push = (point: Point2D) => ({ x: point.x + Math.cos(normal) * depth, y: point.y + Math.sin(normal) * depth });
  return { inner0, inner1, outer0: push(inner0), outer1: push(inner1) };
}

const TAB_SIDES = [1, 3, 5];

function vortac(center: Point2D, radius: number, strokeMm: number): Path[] {
  const tabs = TAB_SIDES.flatMap((side) => solid((inset) => {
    const { inner0, inner1, outer0, outer1 } = hexagonSide(center, radius, side, radius * 0.4 - inset);
    return [inner0, outer0, outer1, inner1, { ...inner0 }];
  }, strokeMm));
  return [hexagon(center, radius), ...tabs];
}

/** The TACAN: the VORTAC's silhouette in one outline, with no hexagon inside. */
function tacan(center: Point2D, radius: number): Path {
  const points = Array.from({ length: 6 }, (_, side) => {
    const { inner0, outer0, outer1 } = hexagonSide(center, radius, side, radius * 0.45);
    return TAB_SIDES.includes(side) ? [inner0, outer0, outer1] : [inner0];
  }).flat();
  return [...points, { ...points[0]! }];
}

/** The NDB: a small ringed dot inside a disc of concentric dotted rings, dots far enough apart to stay separate. */
function ndb(center: Point2D, radius: number, strokeMm: number, dme: boolean): Path[] {
  const core = Math.max(radius * 0.15, strokeMm * 1.2);
  const spacing = Math.max(radius * 0.17, strokeMm * 2.6);
  const square = Math.max(radius * 0.3, core * 1.8);
  const dots: Path[] = [];
  for (let r = core + spacing, row = 0; r <= radius * 0.95 + 1e-9; r += spacing, row += 1) {
    const count = Math.max(6, Math.round((Math.PI * 2 * r) / spacing));
    for (let index = 0; index < count; index += 1) {
      const angle = ((index + (row % 2) / 2) / count) * Math.PI * 2;
      const point = at(center, Math.cos(angle) * r, Math.sin(angle) * r);
      if (dme && Math.abs(point.x - center.x) < square + spacing / 2 && Math.abs(point.y - center.y) < square + spacing / 2) continue;
      dots.push(dot(point, strokeMm * 0.15));
    }
  }
  return [ring(center, core, 16), dot(center, strokeMm * 0.15), ...(dme ? [rectangle(center, square, square)] : []), ...dots];
}

/** The obstacle under 1,000 ft: a Λ over the dot that marks it, `height` tall with the dot at `base`. */
function obstacle(base: Point2D, height: number, dotMm: number): Path[] {
  return [[at(base, -height * 0.3, 0), at(base, 0, -height), at(base, height * 0.3, 0)], dot(at(base, 0, -height * 0.04), dotMm)];
}

/** The obstacle of 1,000 ft and more: a mast that flares into two concave legs, over its dot. */
function tallObstacle(base: Point2D, height: number, dotMm: number): Path[] {
  const junction = at(base, 0, -height * 0.55);
  const leg = (side: number) => Array.from({ length: 7 }, (_, index) => {
    // A quadratic curve from the junction to the foot that hugs the mast before flaring out.
    const t = index / 6;
    const control = { x: side * height * 0.03, y: -height * 0.12 };
    const foot = { x: side * height * 0.32, y: 0 };
    return at(base, 2 * (1 - t) * t * control.x + t * t * foot.x, (1 - t) * (1 - t) * -height * 0.55 + 2 * (1 - t) * t * control.y + t * t * foot.y);
  });
  return [[...leg(-1).reverse(), at(base, 0, -height)], [junction, ...leg(1).slice(1)], dot(at(base, 0, -height * 0.04), dotMm)];
}

/** The wind turbine: a mast on its position with a hub and three blades. */
function windTurbine(base: Point2D, height: number, dotMm: number): Path[] {
  const hub = at(base, 0, -height * 0.7);
  const blade = (degrees: number) => [hub, { x: hub.x + Math.cos(degrees * Math.PI / 180) * height * 0.32, y: hub.y + Math.sin(degrees * Math.PI / 180) * height * 0.32 }];
  return [[base, hub], [at(base, -height * 0.1, 0), at(base, height * 0.1, 0)], blade(-90), blade(30), blade(150), dot(hub, dotMm)];
}

/** High-intensity obstruction lights: short rays and two lightning strokes above the top of the symbol. */
function lightRays(top: Point2D, length: number): Path[] {
  const ray = (degrees: number, from: number, to: number) => {
    const [cos, sin] = [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)];
    return [{ x: top.x + cos * from, y: top.y + sin * from }, { x: top.x + cos * to, y: top.y + sin * to }];
  };
  const bolt = (degrees: number) => {
    const [cos, sin] = [Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180)];
    const along = (t: number, offset: number) => ({ x: top.x + cos * length * t - sin * offset, y: top.y + sin * length * t + cos * offset });
    return [along(0.3, 0), along(0.62, length * 0.12), along(0.62, -length * 0.12), along(1, 0)];
  };
  return [ray(-165, length * 0.3, length * 0.7), bolt(-130), ray(-90, length * 0.3, length * 0.8), bolt(-50), ray(-15, length * 0.3, length * 0.7)];
}

/** Airport details that sit around the basic symbol: fuel ticks and the beacon star. */
function around(center: Point2D, circleRadius: number, radius: number, detail: AviationSymbolDetail, fuelTicks: boolean): Path[] {
  return [
    ...(fuelTicks && detail.fuel ? ticks(center, circleRadius, circleRadius + radius * 0.3, detail.beacon === true) : []),
    ...(detail.beacon ? [star(at(center, 0, -(circleRadius + radius * 0.3)), radius * 0.2)] : []),
  ];
}

function obstacleSymbol(symbol: AviationSymbol, base: Point2D, sizeMm: number, strokeMm: number, lit: boolean): Path[] {
  // Rays take the top quarter, so a lit obstacle stands a little shorter.
  const tall = sizeMm * (lit ? 0.72 : 0.95);
  const short = tall * 0.68;
  const dotMm = strokeMm * 0.3;
  const paths = ((): Path[] => {
    switch (symbol) {
      case "obstacle-tall": return tallObstacle(base, tall, dotMm);
      case "obstacle-group": return [...obstacle(at(base, -short * 0.18, 0), short, dotMm), ...obstacle(at(base, short * 0.18, 0), short, dotMm)];
      case "obstacle-group-tall": return [...obstacle(at(base, -tall * 0.2, 0), short, dotMm), ...tallObstacle(at(base, tall * 0.1, 0), tall, dotMm)];
      case "wind-turbine": return windTurbine(base, tall * 0.75, dotMm);
      case "wind-turbine-group": return [...windTurbine(at(base, -tall * 0.22, 0), tall * 0.58, dotMm), ...windTurbine(at(base, tall * 0.1, 0), tall * 0.75, dotMm)];
      default: return obstacle(base, short, dotMm);
    }
  })();
  if (!lit) return paths;
  // The rays spring from the highest point of the symbol, as the legend draws them.
  const apex = paths.flat().reduce((highest, point) => point.y < highest.y ? point : highest);
  return [...paths, ...lightRays(apex, sizeMm * 0.26)];
}

/**
 * Polylines drawing `symbol` at `anchor`, `sizeMm` across. `strokeMm` is the
 * engraving stroke, which sets hatch spacing and keeps dots apart.
 */
export function aviationSymbolPaths(symbol: AviationSymbol, anchor: Point2D, sizeMm: number, detail: AviationSymbolDetail = {}, strokeMm = DEFAULT_AVIATION_MM): Path[] {
  const radius = sizeMm / 2;
  const center = anchor;
  const circleRadius = radius * 0.55;
  switch (symbol) {
    case "airport": return [circle(center, circleRadius), ...around(center, circleRadius, radius, detail, true)];
    case "airport-hard": {
      // The gap left for each runway is at least 1.2 strokes, and the hatch's round caps reach half a stroke into it.
      const gap = Math.max(circleRadius * 0.15, strokeMm * 0.6);
      const knockouts = fitRunways(detail.runways ?? [], center, circleRadius * 0.78).map((runway) => strip(runway, gap + strokeMm / 2));
      return [...solid((inset) => circle(center, circleRadius - inset), strokeMm, knockouts), ...around(center, circleRadius, radius, detail, true)];
    }
    case "airport-pattern": {
      // Runways are drawn hollow, as charted, when each strip is three strokes wide; a smaller symbol draws their centerlines.
      const halfWidth = Math.max(radius * 0.14, strokeMm * 1.5);
      const hollow = halfWidth <= radius * 0.2;
      const margin = hollow ? halfWidth : strokeMm / 2;
      // A beacon star takes the top of the symbol, so the layout moves down and shrinks.
      const fitted = detail.beacon ? fitRunways(detail.runways ?? [], at(center, 0, radius * 0.2), radius * 0.75 - margin) : fitRunways(detail.runways ?? [], center, radius * 0.95 - margin);
      if (!fitted.length) return aviationSymbolPaths("airport-hard", anchor, sizeMm, detail, strokeMm);
      const runways = hollow ? unionOutline(fitted.map((runway) => strip(runway, halfWidth))) : fitted.map(([start, end]) => [start, end]);
      return [...runways, ...(detail.beacon ? [star(at(center, 0, -radius * 0.8), radius * 0.2)] : [])];
    }
    case "airport-private": return [circle(center, circleRadius), ...letterR(center, circleRadius * 1.05), ...around(center, circleRadius, radius, detail, false)];
    case "airport-military": return [circle(center, circleRadius), circle(center, circleRadius * 0.55), ...around(center, circleRadius, radius, detail, false)];
    case "airport-joint": return [circle(center, circleRadius), circle(center, circleRadius * 0.55), ...around(center, circleRadius, radius, detail, true)];
    case "heliport": return [circle(center, circleRadius), ...letterH(center, circleRadius * 1.05), ...around(center, circleRadius, radius, detail, false)];
    case "seaplane-base": return detail.fuel
      ? [circle(center, circleRadius), ...seaplaneAnchor(center, circleRadius * 1.5), ...around(center, circleRadius, radius, detail, true)]
      : [...seaplaneAnchor(center, radius * 1.5), ...(detail.beacon ? [star(at(center, 0, -radius * 0.95), radius * 0.2)] : [])];
    case "vor": return [hexagon(center, radius * 0.65), dot(center, radius * 0.08)];
    case "vortac": return [...vortac(center, radius * 0.5, strokeMm), dot(center, radius * 0.08)];
    case "tacan": return [tacan(center, radius * 0.5)];
    case "vor-dme": {
      const hex = radius * 0.55;
      return [hexagon(center, hex), rectangle(center, hex, hex * Math.sqrt(3) / 2), dot(center, radius * 0.08)];
    }
    case "dme": return [rectangle(center, radius * 0.5, radius * 0.5)];
    case "ndb": return ndb(center, radius, strokeMm, false);
    case "ndb-dme": return ndb(center, radius, strokeMm, true);
    case "obstacle": case "obstacle-tall": case "obstacle-group": case "obstacle-group-tall": case "wind-turbine": case "wind-turbine-group":
      return obstacleSymbol(symbol, anchor, sizeMm, strokeMm, detail.highIntensity === true);
  }
}

/** True for symbols that stand on their position rather than centering on it. */
export function aviationSymbolStandsOnAnchor(symbol: AviationSymbol): boolean {
  return symbol.startsWith("obstacle") || symbol.startsWith("wind-turbine");
}

/** Radius around the anchor that a symbol occupies, for label offsets and clearance. */
export function aviationSymbolRadius(symbol: AviationSymbol, sizeMm: number): number {
  return aviationSymbolStandsOnAnchor(symbol) ? sizeMm : sizeMm / 2;
}
