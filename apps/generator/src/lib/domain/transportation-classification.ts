import type { MarkingFeature, TransportationClass } from "@topostack/core";

const MAJOR_ROAD_DETAILS = new Set(["motorway", "motorway_link", "trunk", "trunk_link", "primary", "primary_link", "secondary", "secondary_link"]);
const LOCAL_ROAD_DETAILS = new Set(["tertiary", "tertiary_link", "residential", "service", "unclassified", "road", "raceway", "driveway", "parking_aisle", "alley", "drive-through", "emergency_access"]);
const TRAIL_DETAILS = new Set(["pedestrian", "track", "path", "cycleway", "bridleway", "steps", "corridor", "sidewalk", "crossing"]);
const EXCLUDED_TRANSPORT_KINDS = new Set(["aerialway", "ferry", "pier", "aeroway"]);

const RAIL_DETAILS = new Set(["rail", "subway", "light_rail", "tram", "narrow_gauge", "monorail", "funicular", "preserved"]);
const RAIL_SERVICES = new Set(["yard", "siding", "spur", "crossover"]);
const negative = (value: unknown) => value === false || value === "no";
const affirmative = (value: unknown) => value === true || value === "yes";

/** Keep vertical transitions separate while stitching tile fragments. */
export function transportGrade(tags: Record<string, unknown>): Pick<MarkingFeature, "isBridge" | "transportLevel"> {
  const bridge = affirmative(tags.is_bridge) || affirmative(tags.bridge);
  const tunnel = affirmative(tags.is_tunnel) || affirmative(tags.tunnel) || tags.tunnel === "building_passage";
  const raw = tags.layer;
  const explicit = typeof raw === "number" || (typeof raw === "string" && raw.trim()) ? Number(raw) : NaN;
  const level = Number.isSafeInteger(explicit) ? explicit : bridge ? 1 : tunnel ? -1 : 0;
  return { ...(bridge ? { isBridge: true } : {}), ...(level || bridge ? { transportLevel: level } : {}) };
}

/** A generic tunnel flag alone is only a candidate. Keep genuine underground services out of the fallback. */
export function classifyRail(tags: Record<string, unknown>): "rail" | "covered-rail" | "rail-tunnel" | undefined {
  const detail = String(tags.kind_detail || "rail");
  if (!RAIL_DETAILS.has(detail) || RAIL_SERVICES.has(String(tags.service)) || tags.location === "underground" || Number(tags.level) < 0) return undefined;
  const covered = affirmative(tags.covered) || affirmative(tags.is_covered) || tags.covered === "arcade" || tags.covered === "colonnade" || tags.tunnel === "building_passage";
  if (covered) return "covered-rail";
  if (!affirmative(tags.is_tunnel) && !affirmative(tags.tunnel)) return "rail";
  if (detail === "subway" || Number(tags.layer) < 0 || negative(tags.covered) || negative(tags.is_covered)) return undefined;
  return "rail-tunnel";
}

export function classifyTransportation(properties: Record<string, unknown>): TransportationClass | "rail-tunnel" | undefined {
  const kind = typeof properties.kind === "string" ? properties.kind : "";
  const detail = typeof properties.kind_detail === "string" ? properties.kind_detail : "";
  if (EXCLUDED_TRANSPORT_KINDS.has(kind)) return undefined;
  if (kind === "rail") return classifyRail(properties);
  if (kind === "path" || TRAIL_DETAILS.has(detail)) return "trail";
  if (kind === "highway" || kind === "major_road" || MAJOR_ROAD_DETAILS.has(detail)) return "major-road";
  if (kind === "minor_road" || LOCAL_ROAD_DETAILS.has(detail)) return "local-road";
  return undefined;
}
