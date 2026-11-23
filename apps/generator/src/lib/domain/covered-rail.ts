import { distanceToSegment, groundWidthMFor, polylineLength, ringBounds, type GeoBounds, type MarkingFeature, type Point2D } from "@topostack/core";
import { fittingTileWindow, worldXToLon, worldYToLat, type TileWindow } from "$lib/domain/tile-math";
import { stitchTransportationMarkings } from "$lib/domain/vector-cleanup";

// Only the fallback for tiles that omit OSM's covered tag needs these limits.
const MAX_PASSAGE_M = 600;
const STATION_DISTANCE_M = 160;
const RAIL_DETAILS = new Set(["rail", "subway", "light_rail", "tram", "narrow_gauge", "monorail", "funicular", "preserved"]);
const RAIL_SERVICES = new Set(["yard", "siding", "spur", "crossover"]);
const negative = (value: unknown) => value === false || value === "no";
const affirmative = (value: unknown) => value === true || value === "yes";

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

/** Read nearby rail and station evidence even when the maker crops tightly around the middle of a station. */
export function railContextTiles(window: TileWindow, bounds: GeoBounds): { tiles: TileWindow["tiles"]; complete: boolean } {
  const margin = (window.eastX - window.westX) * (MAX_PASSAGE_M + STATION_DISTANCE_M) / groundWidthMFor(bounds);
  const z = window.zoom;
  const padded = fittingTileWindow({
    west: worldXToLon(window.westX - margin, z), east: worldXToLon(window.eastX + margin, z),
    north: worldYToLat(window.northY - margin, z), south: worldYToLat(window.southY + margin, z),
  }, z);
  // Prefer the original resolution if the auxiliary margin would exceed the tile budget.
  return { tiles: padded.zoom === z ? padded.tiles : window.tiles, complete: padded.zoom === z };
}

export interface RailContext {
  stations: Point2D[];
  surface: { label?: string; points: Point2D[] }[];
  tunnels: MarkingFeature[];
}

/** Accept only mapped, bounded station passages whose two ends meet real surface rail vertices. */
export function stationPassages(tiles: RailContext[], mmPerM: number): MarkingFeature[] {
  const stations = tiles.flatMap(tile => tile.stations);
  const tunnels = tiles.flatMap(tile => tile.tunnels);
  if (!(mmPerM > 0) || !Number.isFinite(mmPerM) || !stations.length || !tunnels.length) return [];
  // Only discard sub-micron projection noise from shared vertices on adjacent tiles.
  const key = (point: Point2D) => `${Math.round(point.x * 1e5)},${Math.round(point.y * 1e5)}`;
  const passages = stitchTransportationMarkings(tunnels).filter(({ points }) =>
    points.length >= 2 && key(points[0]!) !== key(points.at(-1)!) && polylineLength(points) <= MAX_PASSAGE_M * mmPerM);
  // Index incident surface segments only at potential portals. A coincident vertex
  // at a crossing gives no evidence that a train can continue along that track.
  type Incident = { next: Point2D; endpoint: boolean; label?: string };
  const portals = new Map<string, Incident[]>();
  for (const { points } of passages) {
    portals.set(key(points[0]!), []);
    portals.set(key(points.at(-1)!), []);
  }
  for (const tile of tiles) for (const { points, label } of tile.surface) {
    for (let i = 0; i < points.length; i++) {
      const incidents = portals.get(key(points[i]!));
      if (!incidents) continue;
      const endpoint = i === 0 || i === points.length - 1;
      for (const next of [points[i - 1], points[i + 1]]) {
        if (next) incidents.push({ next, endpoint, label });
      }
    }
  }
  function continuation(portal: Point2D, inside: Point2D, label?: string): Incident | undefined {
    const dx = portal.x - inside.x, dy = portal.y - inside.y;
    const candidates = new Map<string, Incident>();
    for (const incident of portals.get(key(portal)) ?? []) {
      const { next } = incident;
      if (label && incident.label && label !== incident.label) continue;
      if (!incident.endpoint && !(label && incident.label === label)) continue;
      const sx = next.x - portal.x, sy = next.y - portal.y;
      const magnitude = Math.hypot(dx, dy) * Math.hypot(sx, sy);
      // A surface track must continue within 60 degrees of the passage heading.
      if (!magnitude || dx * sx + dy * sy < magnitude / 2) continue;
      // Buffered tiles can repeat the same ray with a different clipped endpoint.
      const length = Math.hypot(sx, sy);
      const direction = `${Math.round(sx / length * 1e5)},${Math.round(sy / length * 1e5)}`;
      candidates.set(direction + "/" + (incident.label ?? ""), incident);
    }
    if (label) {
      const named = [...candidates.values()].find(track => track.label === label);
      if (named) return named;
    }
    return candidates.size === 1 ? candidates.values().next().value : undefined;
  }
  const radius = STATION_DISTANCE_M * mmPerM;
  const cell = (n: number) => Math.floor(n / radius);
  const nearby = new Map<string, Point2D[]>();
  for (const station of stations) {
    const bin = `${cell(station.x)},${cell(station.y)}`;
    const group = nearby.get(bin);
    if (group) group.push(station); else nearby.set(bin, [station]);
  }
  return passages.filter(({ points, label }) => {
    const start = continuation(points[0]!, points[1]!, label);
    const end = continuation(points.at(-1)!, points.at(-2)!, label);
    if (!start || !end || (!label && start.label && end.label && start.label !== end.label)) return false;
    const box = ringBounds(points);
    for (let x = cell(box.minX - radius); x <= cell(box.maxX + radius); x++) {
      for (let y = cell(box.minY - radius); y <= cell(box.maxY + radius); y++) {
        if (nearby.get(`${x},${y}`)?.some(station => points.some((point, i) => i > 0 && distanceToSegment(station, points[i - 1]!, point) <= radius))) return true;
      }
    }
    return false;
  });
}
