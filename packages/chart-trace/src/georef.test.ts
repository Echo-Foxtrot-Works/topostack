import { describe, expect, it } from "vitest";
import { apply, fitControlPoints, fitTransform, IDENTITY, invert, multiply, resampleRing, ringIou, SNAP_MIN_IOU, snapCandidates, snapToOutline, type Matrix3 } from "./georef.ts";
import { localFrame, type Point2 } from "./local-frame.ts";

const frame = localFrame(-84.72, 44.63);

/** A lopsided lake in local metres: a lobe, a bay, and no symmetry to confuse orientation. */
const lakeMetres: Point2[] = Array.from({ length: 180 }, (_, index) => {
  const angle = (2 * Math.PI * index) / 180;
  const radius = 900 + 280 * Math.cos(angle) + 160 * Math.sin(2 * angle) - 120 * Math.cos(3 * angle + 0.4);
  return [radius * Math.cos(angle) * 1.6, radius * Math.sin(angle)];
});
const outline = lakeMetres.map(([x, y]) => frame.toLonLat(x, y));

/** Ground metres to chart pixels: scaled, rotated, offset, rows running down. */
function chartOf(angle: number, pixelsPerMetre: number, mirror = false): Matrix3 {
  const cos = Math.cos(angle) * pixelsPerMetre;
  const sin = Math.sin(angle) * pixelsPerMetre;
  const flip = mirror ? 1 : -1;
  return [cos, -sin, 1800, sin * flip, cos * flip, 1400, 0, 0, 1];
}

function groundErrorM(matrix: Matrix3, toPixels: Matrix3): number {
  let worst = 0;
  for (const [x, y] of lakeMetres) {
    const [px, py] = apply(toPixels, x, y);
    const [lon, lat] = apply(matrix, px, py);
    const [gx, gy] = frame.toLocal(lon, lat);
    worst = Math.max(worst, Math.hypot(gx - x, gy - y));
  }
  return worst;
}

describe("matrix helpers", () => {
  it("multiplies, inverts, and applies homographies", () => {
    const m: Matrix3 = [2, 0.5, 3, -0.25, 1.5, -7, 1e-4, 2e-4, 1];
    const identity = multiply(m, invert(m));
    identity.forEach((value, index) => expect(value).toBeCloseTo(IDENTITY[index]!, 9));
    const [x, y] = apply(m, 10, 20);
    const [back] = [apply(invert(m), x, y)];
    expect(back[0]).toBeCloseTo(10, 9);
    expect(back[1]).toBeCloseTo(20, 9);
    expect(() => invert([1, 2, 3, 2, 4, 6, 0, 0, 1])).toThrow(/cannot be inverted/);
  });
});

describe("fitTransform", () => {
  const source: Point2[] = [[0, 0], [1000, 40], [980, 760], [20, 800], [500, 400], [250, 610]];

  it("recovers an exact affine map and an exact perspective map", () => {
    const affine: Matrix3 = [0.8, -0.3, 120, 0.25, 0.9, -40, 0, 0, 1];
    const homography: Matrix3 = [0.8, -0.3, 120, 0.25, 0.9, -40, 1.5e-4, -8e-5, 1];
    for (const [truth, model] of [[affine, "affine"], [homography, "homography"]] as const) {
      const target = source.map(([x, y]) => apply(truth, x, y));
      const fitted = fitTransform(source, target, model);
      for (const [x, y] of source) {
        const [u, v] = apply(fitted, x, y);
        const [eu, ev] = apply(truth, x, y);
        expect(Math.hypot(u - eu, v - ev)).toBeLessThan(1e-6);
      }
    }
  });

  it("needs enough pairs that do not all lie on one line", () => {
    expect(() => fitTransform(source.slice(0, 2), source.slice(0, 2), "affine")).toThrow(/at least 3/);
    expect(() => fitTransform(source.slice(0, 3), source.slice(0, 3), "homography")).toThrow(/at least 4/);
    const line: Point2[] = [[0, 0], [1, 1], [2, 2], [3, 3]];
    expect(() => fitTransform(line, line, "affine")).toThrow(/one line/);
  });
});

describe("fitControlPoints", () => {
  const toPixels = chartOf(0.35, 0.8);
  const fromPixels = invert(toPixels);
  const corners: Point2[] = [[-1200, -800], [1300, -700], [1250, 900], [-1100, 850], [100, 50]];
  const controlPoints = (noise: number) => corners.map(([x, y], index) => {
    const [px, py] = apply(toPixels, x, y);
    const [lon, lat] = frame.toLonLat(x, y);
    return { x: px + (index % 2 ? noise : -noise), y: py + (index % 3 ? noise : 0), lon, lat };
  });

  it("places a rotated scan on the ground, defaulting to a homography from four points", () => {
    const fit = fitControlPoints(controlPoints(0));
    expect(fit.model).toBe("homography");
    expect(fit.rmsM).toBeLessThan(1e-3);
    expect(groundErrorM(fit.matrix, toPixels)).toBeLessThan(0.01);
    expect(apply(fromPixels, 0, 0)).toBeDefined();
  });

  it("reports ground residuals for noisy clicks, and fits three points as an affine map", () => {
    const noisy = fitControlPoints(controlPoints(2), "affine");
    expect(noisy.model).toBe("affine");
    expect(noisy.rmsM).toBeGreaterThan(0.5);
    expect(noisy.rmsM).toBeLessThan(5);
    expect(noisy.residualsM).toHaveLength(5);
    const three = fitControlPoints(controlPoints(0).slice(0, 3));
    expect(three.model).toBe("affine");
    expect(groundErrorM(three.matrix, toPixels)).toBeLessThan(0.01);
    expect(() => fitControlPoints(controlPoints(0).slice(0, 2))).toThrow(/three control points/);
  });
});

// Each case searches rotations, mirrorings and offsets over full outlines: 2-4 s
// on a CI runner, and slower under coverage on a busy one. The default 5 s
// timed out on dev (run 463) with nothing wrong.
describe("snapToOutline", { timeout: 30_000 }, () => {
  it.each([
    ["north-up", 0, false],
    ["rotated like the Lake Margrethe sheet", 2.4, false],
    ["mirrored", -0.6, true],
  ])("places a %s chart shoreline on the known outline", (_name, angle, mirror) => {
    const toPixels = chartOf(angle, 0.7, mirror);
    // The traced shoreline starts elsewhere and runs the other way, as a tracer's would.
    const shoreline = lakeMetres.map(([x, y]) => apply(toPixels, x, y)).reverse();
    const rolled = [...shoreline.slice(57), ...shoreline.slice(0, 57)];
    const snap = snapToOutline(rolled, outline);
    expect(snap.iou).toBeGreaterThan(SNAP_MIN_IOU);
    expect(snap.rmsM).toBeLessThan(15);
    expect(groundErrorM(snap.matrix, toPixels)).toBeLessThan(40);
  });

  it("does not lay a symmetric lake down mirror-imaged when both ways overlap equally", () => {
    // Symmetric about its long axis, but with a bay only on one end: the
    // mirrored fit overlaps as well as the true one and puts every point wrong.
    const symmetric: Point2[] = Array.from({ length: 180 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 180;
      const radius = 900 + 280 * Math.cos(angle) - 120 * Math.cos(3 * angle);
      return [radius * Math.cos(angle) * 1.6, radius * Math.sin(angle) + 200 * Math.sin(angle) * Math.cos(angle)];
    });
    const toPixels = chartOf(0.3, 0.7);
    const shoreline = symmetric.map(([x, y]) => apply(toPixels, x, y));
    const snap = snapToOutline(shoreline, symmetric.map(([x, y]) => frame.toLonLat(x, y)));
    expect(snap.iou).toBeGreaterThan(SNAP_MIN_IOU);
    let worst = 0;
    for (const [x, y] of symmetric) {
      const [px, py] = apply(toPixels, x, y);
      const [gx, gy] = frame.toLocal(...(apply(snap.matrix, px, py) as [number, number]));
      worst = Math.max(worst, Math.hypot(gx - x, gy - y));
    }
    expect(worst).toBeLessThan(40);
  });

  it("offers the other way round for a lake that looks the same turned half round", () => {
    // An ellipse fits its own outline just as well turned 180 degrees, so the
    // outline cannot choose; the true placement must be among the alternatives.
    const ellipse: Point2[] = Array.from({ length: 180 }, (_, index) => {
      const angle = (2 * Math.PI * index) / 180;
      return [1440 * Math.cos(angle), 900 * Math.sin(angle)];
    });
    const toPixels = chartOf(2.5, 0.7);
    const candidates = snapCandidates(ellipse.map(([x, y]) => apply(toPixels, x, y)), ellipse.map(([x, y]) => frame.toLonLat(x, y)));
    const close = candidates.filter((candidate) => candidate.iou > candidates[0]!.iou - 0.05);
    expect(close.length).toBeGreaterThan(1);
    const worst = (matrix: Matrix3) => Math.max(...ellipse.map(([x, y]) => {
      const [px, py] = apply(toPixels, x, y);
      const [gx, gy] = frame.toLocal(...(apply(matrix, px, py) as [number, number]));
      return Math.hypot(gx - x, gy - y);
    }));
    expect(Math.min(...close.map((candidate) => worst(candidate.matrix)))).toBeLessThan(40);
    // Refinements that land on the same fit are one placement, not several.
    expect(candidates.length).toBeLessThan(12);
  });

  it("reports a poor overlap instead of pretending a different lake fits", () => {
    // A C-shaped lake: no affine map lays an open ring onto a solid one.
    const arc = (radius: number, reverse: boolean): Point2[] => {
      const points = Array.from({ length: 50 }, (_, index): Point2 => {
        const angle = 0.5 + (index / 49) * (2 * Math.PI - 1);
        return [400 + radius * Math.cos(angle), 400 + radius * Math.sin(angle)];
      });
      return reverse ? points.reverse() : points;
    };
    expect(snapToOutline([...arc(400, false), ...arc(220, true)], outline).iou).toBeLessThan(SNAP_MIN_IOU);
  });

  it("needs two real shapes", () => {
    expect(() => snapToOutline([[0, 0], [1, 1]], outline)).toThrow(/traced shoreline/);
    expect(() => snapToOutline([[0, 0], [1, 1], [2, 2], [3, 3]], outline)).toThrow(/enclose an area/);
  });
});

describe("ring helpers", () => {
  it("resamples a ring evenly and measures overlap", () => {
    const square: Point2[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const samples = resampleRing(square, 8);
    expect(samples).toEqual([[0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]]);
    expect(ringIou(square, square)).toBeCloseTo(1, 6);
    expect(ringIou(square, [[5, 0], [15, 0], [15, 10], [5, 10]])).toBeCloseTo(1 / 3, 1);
    expect(ringIou([[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]])).toBe(0);
  });
});
