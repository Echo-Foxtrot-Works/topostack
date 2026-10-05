import type { ProjectConfigV1 } from "../types.js";


function stableProjectValue(config: ProjectConfigV1): unknown {
  // Sheet nesting only arranges finished parts on stock at export time, for wood and acrylic alike.
  const { explodedPreview: _previewOnly, name: _packageMetadata, sheetNesting: _exportOnly, waterInsertSheetNesting: _acrylicExportOnly, ...fabricationConfig } = config;
  return {
    ...fabricationConfig,
    // A marker's or path's name is what the maker calls it, never anything the
    // geometry reads, so renaming one must not restate the design. Projects
    // without names hash exactly as they did before names existed.
    markers: config.markers.map(({ name: _label, ...marker }) => marker),
    customLines: config.customLines.map(({ name: _label, ...line }) => line),
    // Likewise an uploaded icon's name; its shapes are the design.
    markerIcons: config.markerIcons?.map(({ name: _label, ...icon }) => icon),
    customGraphics: config.customGraphics?.map(({ name: _label, ...graphic }) => graphic),
    // Which lakes stay wood is a set; the order they were switched off in is not the design.
    waterInserts: config.waterInserts && { ...config.waterInserts, excludedLakeIds: [...config.waterInserts.excludedLakeIds].sort() },
    location: { ...config.location, bounds: config.location.bounds ? { ...config.location.bounds } : undefined },
  };
}

// Canonical JSON: object keys sorted recursively so value-identical configs
// hash identically regardless of key insertion order.
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** 32-bit FNV-1a of a string, as eight hex digits. */
export function fnv1aHex(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function projectFingerprint(config: ProjectConfigV1): string {
  return `v9-${fnv1aHex(stableStringify(stableProjectValue(config)))}`;
}
