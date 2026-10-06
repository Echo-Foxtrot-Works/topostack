import { isMercatorBoundsTuple } from "./geo-bounds.ts";

/** Contract shared by the browser, gateway, and offline survey provisioning. */
export interface SurveySource {
  id: string;
  name: string;
  url: string;
  license: string;
  bounds: [number, number, number, number];
  encoding: "depth-terrarium-v1" | "elevation-terrarium-v1";
  maxZoom: number;
}

/** Fail at startup/build time rather than silently selecting the wrong decoder. */
export function validateSurveyCatalog(value: unknown): { sources: SurveySource[] } {
  if (!value || typeof value !== "object" || !("sources" in value) || !Array.isArray(value.sources)) {
    throw new Error("Survey catalog must contain a sources array.");
  }
  const ids = new Set<string>();
  const sources = value.sources.map((item: unknown): SurveySource => {
    if (!item || typeof item !== "object") throw new Error("Invalid survey source.");
    const source = item as Record<string, unknown>;
    const text = (field: string): string => {
      const value = source[field];
      if (typeof value !== "string" || !value.trim()) throw new Error(`Survey source requires ${field}.`);
      return value;
    };
    const id = text("id");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*-v[1-9]\d*$/.test(id) || ids.has(id)) throw new Error(`Invalid or duplicate survey ID: ${id}`);
    ids.add(id);
    const url = text("url");
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error(`Invalid source URL: ${id}`);
    const bounds = source.bounds;
    if (!isMercatorBoundsTuple(bounds)) throw new Error(`Invalid survey bounds: ${id}`);
    const encoding = source.encoding;
    if (encoding !== "depth-terrarium-v1" && encoding !== "elevation-terrarium-v1") throw new Error(`Unsupported survey encoding: ${id}`);
    const maxZoom = source.maxZoom;
    if (typeof maxZoom !== "number" || !Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 15) throw new Error(`Invalid survey maxZoom: ${id}`);
    return { id, name: text("name"), url, license: text("license"), bounds: [...bounds], encoding, maxZoom };
  });
  return { sources };
}

export interface TerrainSource extends SurveySource {
  minZoom: number;
  verticalDatum: "CGVD2013";
  kind: "lidar-dtm" | "national-dtm";
  priority: number;
  nativeResolutionM: number;
  acquisitionYear?: number;
}

/** Terrain archives share the numeric PNG contract, but never encode depths. */
export function validateTerrainCatalog(value: unknown): { sources: TerrainSource[] } {
  const validated = validateSurveyCatalog(value);
  const raw = (value as { sources: Record<string, unknown>[] }).sources;
  return { sources: validated.sources.map((source, index) => {
    const item = raw[index]!;
    if (source.encoding !== "elevation-terrarium-v1" || item.verticalDatum !== "CGVD2013" ||
        typeof item.minZoom !== "number" || !Number.isInteger(item.minZoom) || item.minZoom < 0 || item.minZoom > source.maxZoom ||
        !["lidar-dtm", "national-dtm"].includes(String(item.kind)) ||
        typeof item.priority !== "number" || !Number.isInteger(item.priority) || item.priority < 1 || item.priority > 1000 ||
        typeof item.nativeResolutionM !== "number" || !Number.isFinite(item.nativeResolutionM) || item.nativeResolutionM <= 0 || item.nativeResolutionM > 1000 ||
        (item.acquisitionYear !== undefined && (typeof item.acquisitionYear !== "number" || !Number.isInteger(item.acquisitionYear) || item.acquisitionYear < 1900 || item.acquisitionYear > 2100))) {
      throw new Error(`Invalid terrain source: ${source.id}`);
    }
    return { ...source, minZoom: item.minZoom, verticalDatum: item.verticalDatum, kind: item.kind as TerrainSource["kind"], priority: item.priority, nativeResolutionM: item.nativeResolutionM, ...(item.acquisitionYear === undefined ? {} : { acquisitionYear: item.acquisitionYear as number }) };
  }) };
}

/** Explicit quality priority; registry order can never change terrain selection. */
export function rankTerrainSources(sources: readonly TerrainSource[]): TerrainSource[] {
  return [...sources].sort((a, b) => b.priority - a.priority || a.nativeResolutionM - b.nativeResolutionM || (b.acquisitionYear ?? 0) - (a.acquisitionYear ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** PMTiles stores bounds at 1e-7 degree precision; allow rounding, not new coverage. */
export function validateTerrainArchiveBounds(actual: unknown, expected: readonly number[]): void {
  if (!Array.isArray(actual) || actual.length !== 4 || actual.some((value: unknown, index: number) =>
    typeof value !== "number" || !Number.isFinite(value) || Math.abs(value - expected[index]!) > 1e-6)) {
    throw new Error("Terrain archive extent does not match registration.");
  }
}
