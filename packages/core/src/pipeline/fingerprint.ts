import type { ProjectConfigV1 } from "../types.js";
import { fnv1aHex, stableStringify } from "../primitives/hash.js";


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

export function projectFingerprint(config: ProjectConfigV1): string {
  return `v10-${fnv1aHex(stableStringify(stableProjectValue(config)))}`;
}
