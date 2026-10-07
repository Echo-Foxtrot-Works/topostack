import { applySurveyProvenance } from "$lib/domain/bathymetry";
import { loadAviation, loadSurveyedLakeDepths } from "$lib/domain/data-provider";
import { loadLakeAreas } from "$lib/domain/lake-area-loader";
import { loadVectorMarkings } from "$lib/domain/vector-loader";
import { assembleWater } from "$lib/domain/water-assembly";
import { resolveLakeOutlines } from "$lib/domain/lake-outlines";
import { dataZoom } from "$lib/domain/tile-math";
import { SourcePreparationCache } from "$lib/studio/source-refresh";

/** @public The map-data refresh cache with the real loaders. App.svelte imports this module with its first preview edit. */
export function createSourcePreparation(): SourcePreparationCache {
  return new SourcePreparationCache({ loadVectorMarkings, loadLakeAreas, loadSurveyedLakeDepths, applySurveyProvenance, resolveLakeOutlines, assembleWater, loadAviation, dataZoom });
}
