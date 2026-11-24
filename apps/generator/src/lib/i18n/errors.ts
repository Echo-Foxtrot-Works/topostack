import { t, type MessageKey } from "$lib/i18n/i18n.svelte";

/**
 * English messages raised where the catalog cannot be imported (the geometry
 * worker, the MCP App's data provider, storage) and shown on screen later.
 * Each maps to a catalog message; captures become params in order.
 */
const KNOWN: Array<{ pattern: RegExp; key: MessageKey; params?: string[] }> = [
  { pattern: /^Terrain service returned (\d+)\.$/, key: "domain.terrainServiceStatus", params: ["status"] },
  { pattern: /^Terrain tile is missing its dataset version\.$/, key: "domain.terrainTileVersionMissing" },
  { pattern: /^Terrain tile contains no elevation samples\.$/, key: "domain.terrainTileNoData" },
  { pattern: /^Terrain tiles came from inconsistent dataset versions\. Try again shortly\.$/, key: "domain.terrainTileVersionsMixed" },
  { pattern: /^The terrain service could not be reached\.$/, key: "domain.terrainUnreachable" },
  { pattern: /^Water outlines could not be assembled\.$/, key: "domain.waterOutlinesUnassembled" },
  { pattern: /^Lake outlines could not be loaded\.$/, key: "domain.lakeOutlinesUnavailable" },
  { pattern: /^Lake outline coverage could not be checked\.$/, key: "domain.lakeOutlineCoverageUnknown" },
  { pattern: /^Couldn't load the (.+) font\. Check your connection and try again\.$/, key: "domain.fontLoadFailed", params: ["font"] },
  { pattern: /^Saved project could not be read · a backup copy was kept$/, key: "domain.savedProjectUnreadableBackup" },
  { pattern: /^Saved project could not be read · autosave paused to protect it$/, key: "domain.savedProjectUnreadablePaused" },
  { pattern: /^(.+) could not load · reload to update TopoStack$/, key: "domain.moduleLoadFailed", params: ["module"] },
  // Browsers word a failed request differently; all mean the connection dropped.
  { pattern: /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.|Network request failed)$/, key: "domain.networkFailed" },
];

/** Module names `ModuleLoadError` is given, shown in the user's language. */
const MODULES: Record<string, MessageKey> = { "The geometry engine": "domain.moduleGeometryEngine", "Terrain loading": "domain.moduleTerrainLoading", "Map data refresh": "domain.moduleMapDataRefresh" };

/** A known English message in the studio's language; anything else unchanged. */
export function localMessage(message: string): string {
  for (const { pattern, key, params = [] } of KNOWN) {
    const match = pattern.exec(message);
    if (!match) continue;
    const values = Object.fromEntries(params.map((name, index) => {
      const value = match[index + 1] ?? "";
      if (name === "module" && MODULES[value]) return [name, t(MODULES[value]!)];
      return [name, /^\d+$/.test(value) && name !== "status" ? Number(value) : value];
    }));
    return t(key, values);
  }
  return message;
}

/** What to show for a caught error: its message in the studio's language, or `fallback` when it has none. */
export function errorText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? localMessage(error.message) : fallback;
}
