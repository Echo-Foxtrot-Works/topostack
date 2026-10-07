/**
 * The strip packer the sheet planner drives. `@topostack/nest-wasm` (sparrow)
 * satisfies it structurally; core never imports that package, so the
 * generator's nest worker hands one in. `rectangleEngine` is the in-core
 * fallback.
 *
 * A job fits every item into a strip `stripHeight` tall and as short as
 * possible along x. A placement maps an item's outline onto the strip as
 * `p' = R(rotationDeg) · p + (x, y)`; placed outlines lie inside
 * `[0, stripWidth] × [0, stripHeight]` and stay `spacing` apart.
 */
import type { SheetNestEngineName } from "../../types.js";

export interface StripEngineItem {
  outline: Array<[number, number]>;
  /** Allowed rotations in degrees; absent means any angle. */
  orientationsDeg?: number[];
}

export interface StripEngineJob {
  items: StripEngineItem[];
  stripHeight: number;
  spacing: number;
  timeLimitMs: number;
  /** Stop as soon as a layout this short is found. */
  targetWidth?: number;
  seed: number;
}

export interface StripEnginePlacement {
  index: number;
  rotationDeg: number;
  x: number;
  y: number;
}

export interface StripEngineResult {
  stripWidth: number;
  placements: StripEnginePlacement[];
}

export interface StripEngine {
  readonly name: SheetNestEngineName;
  readonly info?: { sparrowRev?: string; jaguaVersion?: string };
  /** Throws when the items cannot be laid out at all, e.g. one is taller than the strip. */
  pack(job: StripEngineJob): StripEngineResult | Promise<StripEngineResult>;
}
