import { aviationRequested, aviationSymbolsFillIn } from "./aviation.js";
import { sourceRequirements } from "./source-requirements.js";
import type { GenerationContext } from "./generation-context.js";

export function addSourceWarnings({ config, source, usesWaterDepth, warnings, aviation }: GenerationContext): void {
  if (source.terrainSourceUnavailable) warnings.push({
    code: "TERRAIN_SOURCE_FALLBACK",
    message: "Higher-resolution terrain is unavailable for this area. The map uses the standard elevation source instead.",
  });
  if ((source.elevationRepairCount ?? 0) > 0) warnings.push({
    code: "ELEVATION_REPAIRED",
    message: "Isolated depth spikes in the elevation data were replaced with estimates from nearby terrain. Review the terrain before cutting.",
  });
  const wantsVectorData = sourceRequirements(config).vectors;
  if (source.vectorStatus === "partial" && wantsVectorData) warnings.push({
    code: "VECTOR_DATA_PARTIAL",
    message: "The map detail feature limit was reached, so some roads, trails, water lines, or boundaries may be missing.",
  });
  if (source.vectorStatus === "unavailable" && wantsVectorData) warnings.push({
    code: "VECTOR_DATA_UNAVAILABLE",
    message: "Map detail data is unavailable. This project cannot be exported until the map data is restored or those details are disabled.",
  });
  if (aviationRequested(config)) {
    if (source.aviationStatus === "partial") warnings.push({
      code: "AVIATION_DATA_PARTIAL",
      message: "The aviation feature limit was reached, so some airspace, airports, navaids, or obstacles may be missing. Narrow the map area or turn off some aviation details.",
    });
    if (source.aviationStatus === "unavailable") warnings.push({
      code: "AVIATION_DATA_UNAVAILABLE",
      message: "FAA aviation data is unavailable. This project cannot be exported until the data is restored or aviation details are turned off.",
    });
    if (source.aviationStatus === "not-covered") warnings.push({
      code: "AVIATION_NOT_COVERED",
      message: "FAA aviation data covers only the United States and its territories, so this area has no aviation detail.",
    });
    if (aviationSymbolsFillIn(config.lineStyle) && aviation.lines.some((line) => line.aviationClass === "airport" || line.aviationClass === "navaid" || line.aviationClass === "obstacle")) warnings.push({
      code: "AVIATION_SYMBOLS_FILLED",
      message: "Aviation symbols are less than ten aviation line widths across, so their inner detail engraves solid and airports, navaids and obstacles look alike. Enlarge the symbol size or thin the aviation line width.",
    });
  }
  if (source.lakeDataStatus === "unavailable" && usesWaterDepth) warnings.push({
    code: "LAKE_DATA_UNAVAILABLE",
    message: "Lake depth data is unavailable. Disable water depth or regenerate after the service is restored before exporting.",
  });
  if ((source.bathymetryStatus === "unavailable" || source.bathymetryStatus === "partial") && usesWaterDepth) warnings.push({
    code: "BATHYMETRY_FALLBACK",
    message: "Some surveyed lake-floor data is unavailable. Gaps use existing terrain or modeled basins instead.",
  });
}
