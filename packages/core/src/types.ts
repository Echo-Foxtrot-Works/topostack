export type CropShape = "rectangle" | "circle";
export type OutputMode = "stack" | "engraving";
export type TrailPattern = "solid" | "dashed" | "dotted";
export type WaterFillPattern = "none" | "lines" | "ripples" | "dots";
export type RoadStyle = "centerline" | "outlined";
export type RoadCap = "round" | "square";
export type Operation = "cut" | "score" | "engrave";
export type UnitSystem = "metric" | "imperial";
/**
 * Every engraving font a project can name. The first three draw the built-in
 * bitmap table; the rest are curated typefaces whose glyph data the host loads
 * and registers (see annotate/font-data.ts). Ids are stored in projects and
 * never change meaning.
 */
export const TEXT_FONTS = ["technical", "rounded", "stencil", "hershey-sans", "hershey-serif", "hershey-script", "relief", "jost", "oswald", "lora", "roboto-slab"] as const;
export type TextFont = typeof TEXT_FONTS[number];
export type TransportationClass = "major-road" | "local-road" | "trail";
export type NorthArrowStyle = "minimal" | "classic" | "mariner";
export type BuiltInMarkerSymbol = "pin" | "circle" | "triangle" | "star" | "cross";
/** A built-in marker shape, or `custom` for one of the project's own icons (see MarkerIconV1). */
export type MarkerSymbol = BuiltInMarkerSymbol | "custom";
export type CustomLineKind = "trail" | "boundary";
export type NorthArrowAnchor = "top-left" | "top" | "top-right" | "left" | "center" | "right" | "bottom-left" | "bottom" | "bottom-right";

export interface MapMarkerV1 extends GeoPoint {
  id: string;
  symbol: MarkerSymbol;
  /** Nominal symbol size in millimeters; omitted legacy values use 8 mm. */
  sizeMm?: number;
  /**
   * What the maker calls this marker. It is for finding it again in a long
   * list; nothing is engraved from it, and it is absent until one is typed.
   */
  name?: string;
  /** The project icon a `custom` marker draws; absent for built-in symbols. */
  iconId?: string;
}

/**
 * One filled region of a marker icon: rings as flat `[x0, y0, x1, y1, …]`
 * integers, open (the closing point is implied), y down. Holes are cut out of
 * the outer ring.
 */
export interface MarkerIconShapeV1 {
  outer: number[];
  holes?: number[][];
}

/**
 * A marker symbol the maker supplied as an SVG. It is stored as the filled
 * region the SVG paints, already flattened, simplified, and fitted so its
 * longer side spans MARKER_ICON_UNITS centered on 0, so a marker scales it
 * like any built-in symbol and nothing about the SVG is kept.
 */
export interface MarkerIconV1 {
  id: string;
  name: string;
  /** `bottom` puts the icon's lowest point on the marker's position, as a pin's tip; absent centers it. */
  anchor?: "bottom";
  shapes: MarkerIconShapeV1[];
}

/** The built-in symbols, in picker order. `custom` markers name an icon instead. */
export const MARKER_SYMBOLS: readonly BuiltInMarkerSymbol[] = ["pin", "circle", "triangle", "star", "cross"];
export const MAP_MARKER_SIZE_MM = 8;
export const MAP_MARKER_MIN_SIZE_MM = 1;
export const MAP_MARKER_MAX_SIZE_MM = 200;
export const MAP_MARKER_CLEARANCE_MM = 1.2;
/** An icon's longer side in stored units; coordinates run from -500 to 500. */
export const MARKER_ICON_UNITS = 1000;
export const MAX_MARKER_ICONS = 24;
/** Points across every ring of one icon. Keeps a project with a few icons shareable as a link. */
export const MAX_MARKER_ICON_POINTS = 800;
/** Same shape as a depth chart id: 8-64 lowercase letters, digits or dashes. */
export const MARKER_ICON_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

/**
 * Artwork the maker uploaded to place freely on the piece: a logo, a badge, a
 * decoration. Stored exactly as a marker icon is (integer rings fitted so the
 * longer side spans MARKER_ICON_UNITS about 0), with a larger point budget.
 */
export interface CustomGraphicV1 {
  id: string;
  name: string;
  shapes: MarkerIconShapeV1[];
}

/** What the laser does with a placed graphic: engrave its filled shape, score its outline, or cut it out of the sheet it lands on. */
export type GraphicOperation = "engrave" | "score" | "cut";
export const GRAPHIC_OPERATIONS: readonly GraphicOperation[] = ["engrave", "score", "cut"];

/**
 * One use of a custom graphic on the piece. Anchored like the north arrow, so
 * it stays where the maker put it when the crop or output size changes.
 */
export interface PlacedGraphicV1 {
  id: string;
  graphicId: string;
  placement: NorthArrowPlacementV1;
  /** The graphic's longer side before rotation, in millimeters. */
  sizeMm: number;
  /** Clockwise on the artwork (y down), in degrees from 0 up to 360. */
  rotationDeg: number;
  operation: GraphicOperation;
}

export const MAX_CUSTOM_GRAPHICS = 24;
export const MAX_PLACED_GRAPHICS = 50;
/** Points across every ring of one graphic. Detailed enough for a logo; large projects share as a file rather than a link. */
export const MAX_CUSTOM_GRAPHIC_POINTS = 3_000;
export const GRAPHIC_MIN_SIZE_MM = 3;
export const GRAPHIC_MAX_SIZE_MM = 400;
export const CUSTOM_LINE_KINDS: readonly CustomLineKind[] = ["trail", "boundary"];
export const MAX_PROJECT_NAME_LENGTH = 120;
export const MAX_PROJECT_DIMENSION_MM = 10_000;
export const MAX_MAP_MARKERS = 250;
export const MAX_CUSTOM_LINES = 250;
export const MAX_CUSTOM_LINE_POINTS = 2_000;
export const MAX_CUSTOM_DATA_POINTS = 10_000;
/** How long a marker or path name may be. Long enough to be a sentence, short enough to list. */
export const MAX_CUSTOM_DATA_NAME_LENGTH = 60;

/** A machine bed smaller than this cannot hold a piece worth cutting. */
export const MIN_WORK_AREA_MM = 20;
/** Seam divisions per axis. Caps the piece count and keeps cell letters inside A-Z. */
export const MAX_SEAM_DIVISIONS = 12;
/** Largest seam offset between adjacent layers; a wider stagger buys no more strength. */
export const MAX_SEAM_OFFSET_MM = 50;
/** Total pieces across the stack. Past this the split is abandoned, never emitted partially. */
export const MAX_WORK_AREA_PIECES = 400;

export interface CustomLineFeatureV1 {
  id: string;
  kind: CustomLineKind;
  points: GeoPoint[];
  /** What the maker calls this path. Bookkeeping, like a marker's name. */
  name?: string;
}

export interface NorthArrowPlacementV1 {
  anchor: NorthArrowAnchor;
  /** Fine adjustment as a fraction of the available center travel. */
  offset: Point2D;
}

export const NORTH_ARROW_STYLES: readonly NorthArrowStyle[] = ["minimal", "classic", "mariner"];
export const NORTH_ARROW_ANCHORS: readonly NorthArrowAnchor[] = ["top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right"];
export const NORTH_ARROW_MIN_SIZE_MM = 12;
export const NORTH_ARROW_MAX_SIZE_MM = 200;
export const NORTH_ARROW_MAX_MAP_FRACTION = 0.45;

/** The largest north arrow that fits a map of this size. */
export function northArrowMaximumMm(widthMm: number, heightMm: number): number {
  return Math.min(NORTH_ARROW_MAX_SIZE_MM, Math.max(NORTH_ARROW_MIN_SIZE_MM, Math.min(widthMm, heightMm) * NORTH_ARROW_MAX_MAP_FRACTION));
}

/** Engraved title text, such as a place name and date, anchored like the north arrow. */
export interface PlaqueV1 {
  /** Kept when switched off so the text survives toggling. */
  enabled: boolean;
  /** Up to PLAQUE_MAX_LINES lines separated by newlines; the built-in fonts engrave them in capitals. */
  text: string;
  /** Cap height in millimeters. */
  sizeMm: number;
  placement: NorthArrowPlacementV1;
  /** The title's own font. Absent means it follows `textStyle.font`, which keeps older projects' fingerprints. */
  font?: TextFont;
}

export const PLAQUE_MAX_LINES = 3;
export const PLAQUE_MAX_LINE_LENGTH = 40;
export const PLAQUE_MIN_SIZE_MM = 3;
export const PLAQUE_MAX_SIZE_MM = 30;
export const DEFAULT_PLAQUE_SIZE_MM = 6;

export interface TextStyleV1 {
  font: TextFont;
  /** Physical cap height of fabrication text in millimeters. */
  sizeMm: number;
}

/** Physical stroke hierarchy shared by previews and machine SVGs. */
export interface LineStyleV1 {
  contourMm: number;
  indexContourMm: number;
  majorRoadMm: number;
  localRoadMm: number;
  trailMm: number;
  waterMm: number;
  boundaryMm: number;
  coordinateGridMm: number;
  annotationMm: number;
  borderMm: number;
  trailPattern: TrailPattern;
  /** Major roads can be a single continuous stroke or two parallel edge strokes. */
  roadStyle: RoadStyle;
  /** Center-to-center spacing between the two strokes used by outlined major roads. */
  majorRoadSpacingMm: number;
  roadCap: RoadCap;
}

export const DEFAULT_LINE_STYLE: LineStyleV1 = {
  contourMm: 0.16,
  indexContourMm: 0.32,
  majorRoadMm: 0.38,
  localRoadMm: 0.26,
  trailMm: 0.22,
  waterMm: 0.3,
  boundaryMm: 0.24,
  coordinateGridMm: 0.16,
  annotationMm: 0.2,
  borderMm: 0.34,
  trailPattern: "dashed",
  roadStyle: "centerline",
  majorRoadSpacingMm: 0.8,
  roadCap: "round",
};

export const DEFAULT_TEXT_STYLE: TextStyleV1 = { font: "technical", sizeMm: 3.1 };

export const MIN_LAYER_COUNT = 2;
export const MIN_VERTICAL_EXAGGERATION = 1;
export const MAX_VERTICAL_EXAGGERATION = 10;

/**
 * Water depth is exaggerated relative to the terrain, not independently of it.
 * The carve writes real metres and the whole stack is contoured at one step, so
 * depth already rises and falls with `verticalExaggeration`; this multiplies it
 * on top of that. 1x keeps water on exactly the terrain's vertical scale.
 */
// The water toggle is the off switch, so the scale never reaches zero: two
// ways to say "flat" would leave the depth panel emptying itself mid-drag.
export const MIN_WATER_DEPTH_EXAGGERATION = 0.25;
export const MAX_WATER_DEPTH_EXAGGERATION = 4;

/** Sea level, and the elevation the threshold ladder snaps to when ocean is present. */
export const SEA_LEVEL_M = 0;

/**
 * A DEM already knows a water body's depth when its interior varies by more
 * than this. Terrarium carries real soundings for oceans but renders every
 * lake - the Great Lakes included - flat at surface elevation, so this is what
 * separates "carve a modeled basin" from "leave the survey alone".
 */
export const BATHYMETRIC_RELIEF_M = 5;

export type WaterKind = "ocean" | "lake";
export type DepthSource = "surveyed" | "mixed" | "modeled" | "user";
/** Where a lake's depth grid came from: a published survey, or a depth chart someone traced into a grid. */
export type BathymetryOrigin = "survey" | "chart";

/**
 * Physical consequences of a config plus its terrain relief. Layer count is a
 * result of the model's own scale, never an input: the stack is as tall as the
 * exaggerated relief demands, and the material thickness decides how many
 * sheets that takes.
 */
export interface TerrainStackPlan {
  /** Layers the relief resolves to at this scale and thickness, with a two-sheet minimum. */
  layerCount: number;
  /** Exaggeration actually applied after rounding to whole sheets and enforcing the minimum. */
  verticalExaggeration: number;
  stackHeightMm: number;
  /** Sheets below the land minimum, optionally limited by waterDepthLayerLimit. */
  depthLayerCount: number;
  /** Elevation covered by one sheet of material. */
  metersPerLayer: number;
  /** Horizontal scale as a fraction - 1/78247 for the bundled preview. */
  horizontalScale: number;
}

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface GeoBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

/**
 * A depth chart's id: 8-64 lowercase letters, digits or dashes. The chart
 * record contract states the same pattern (`CHART_ID_PATTERN`); core is built
 * on its own and cannot import it, so a test holds the two together.
 */
export const DEPTH_CHART_ID_PATTERN = /^[a-z0-9][a-z0-9-]{7,63}$/;

/**
 * The key for a lake HydroLAKES does not know, mostly small lakes drawn only
 * in OpenStreetMap. Their outlines carry no lasting id, so the chart itself
 * names the lake: `outline:<chart id>`, and the lake is the one the chart's
 * own outline overlaps.
 */
export const OUTLINE_CHART_KEY_PREFIX = "outline:";

/**
 * Whether `key` may name the lake a chart reference carves: a HydroLAKES id, or
 * `outline:` followed by that same chart's id.
 */
export function isDepthChartLakeKey(key: string, reference: Pick<UserDepthChartRefV1, "id">): boolean {
  return /^[1-9]\d*$/.test(key) || key === `${OUTLINE_CHART_KEY_PREFIX}${reference.id}`;
}

/** The key a project uses for the lake a chart was traced for. */
export function depthChartLakeKey(chart: { id: string; hylakId?: number }): string {
  return chart.hylakId === undefined ? `${OUTLINE_CHART_KEY_PREFIX}${chart.id}` : String(chart.hylakId);
}

/** Which traced depth chart a lake uses, and the exact content it was carved from. */
export interface UserDepthChartRefV1 {
  /** The chart record's id, as stored in the browser or exported beside the project. */
  id: string;
  /** SHA-256 of the record, so a changed chart is a changed project. */
  contentHash: string;
}

export interface ProjectConfigV1 {
  schemaVersion: 1;
  id: string;
  name: string;
  location: GeoPoint & { label: string; zoom: number; bounds?: GeoBounds };
  cropShape: CropShape;
  units: UnitSystem;
  /** Physical result: a layered cut model or one flat engrave-only graphic. */
  outputMode: OutputMode;
  widthMm: number;
  heightMm: number;
  /** Number of elevation contour lines in a flat engraving. */
  engravingContourCount: number;
  /** Every nth contour is emitted as a heavier index contour. */
  engravingIndexInterval: number;
  /** Adds an engraved outline around the selected crop. Never a cut path. */
  showEngravingBorder: boolean;
  lineStyle: LineStyleV1;
  materialThicknessMm: number;
  verticalExaggeration: number;
  minimumFeatureMm: number;
  smoothing: number;
  showRoads: boolean;
  showTrails: boolean;
  showTransportationLabels: boolean;
  showWater: boolean;
  /** Optional vector pattern engraved inside water areas in flat mode. */
  waterFillPattern: WaterFillPattern;
  showBoundaries: boolean;
  showCoordinateGrid: boolean;
  showWaterDepth: boolean;
  /** Depth multiplier relative to the terrain's vertical scale; 1 matches it. */
  waterDepthExaggeration: number;
  /** Maximum additional sheets below the lowest land; undefined uses all required depth sheets. */
  waterDepthLayerLimit?: number;
  /** Compress each lake around its waterline only when the stack cannot hold its requested depth. */
  fitLakeDepth: boolean;
  /** Per-lake maximum-depth overrides in meters, keyed by HydroLAKES id. */
  waterDepthOverrides: Record<string, number>;
  showAlignmentGuides: boolean;
  optimizeMaterialUse: boolean;
  glueMarginMm: number;
  laserKerfMm: number;
  /**
   * Machine work area in millimeters. A model larger than the bed is cut as
   * several pieces that butt together along a seam grid. 0 on an axis means
   * that axis is unlimited (a roll feeder, a pass-through slot); 0 on both
   * disables splitting entirely.
   */
  workAreaWidthMm: number;
  workAreaHeightMm: number;
  /**
   * How far a seam in one layer sits from the matching seam in the layers
   * glued above and below it, so the joints never stack into one crack. Half
   * of it is added to the end cells, which can cost an extra division when
   * the model barely overflows the bed.
   */
  seamOffsetMm: number;
  /**
   * Cuts interlocking jigsaw tabs into split seams wherever the next layer
   * hides them, so each piece only fits its true neighbour and self-aligns.
   */
  seamTabs: boolean;
  /** Engraves a covered piece id on every piece of a split layer. */
  showAssemblyLabels: boolean;
  /**
   * Region kinds that get a paper paint stencil per fabrication panel, cut to
   * the piece outline with windows over the region that stays visible after
   * assembly. Layered output only; each kind is listed at most once.
   */
  paintTemplates: PaintRegionKind[];
  /**
   * How the export step packs cut parts onto stock sheets. An export setting:
   * it never changes the geometry, so the fingerprint ignores it. Absent in
   * every project that never opened the setting.
   */
  sheetNesting?: SheetNestSettingsV1;
  showElevationLabels: boolean;
  elevationLabelPosition: Point2D;
  textStyle: TextStyleV1;
  showNorthArrow: boolean;
  northArrowStyle: NorthArrowStyle;
  northArrowSizeMm: number;
  northArrowPlacement: NorthArrowPlacementV1;
  showScaleBar: boolean;
  /** Where the scale bar sits. Absent keeps its original spot near the top-left edge, and older projects' fingerprints. */
  scaleBarPlacement?: NorthArrowPlacementV1;
  /** Optional engraved title. Absent in projects saved before titles existed, which keeps their fingerprints. */
  plaque?: PlaqueV1;
  /**
   * Depth charts the maker traced, one per lake, keyed by HydroLAKES id as
   * `waterDepthOverrides` is, or for a lake without one by
   * `outline:<chart id>` (see OUTLINE_CHART_KEY_PREFIX). The chart itself lives in browser storage or
   * beside the project in its exported file; this records which chart a lake
   * uses and the content it was carved from. Absent in every project without
   * one, which keeps their fingerprints.
   */
  userDepthCharts?: Record<string, UserDepthChartRefV1>;
  /** User-placed symbols, projected from geographic coordinates onto the artwork. */
  markers: MapMarkerV1[];
  /**
   * Symbols the maker uploaded, which `custom` markers draw. Absent in every
   * project without one, which keeps their fingerprints.
   */
  markerIcons?: MarkerIconV1[];
  /** Artwork uploaded for free placement on the piece. Absent in every project without one, which keeps their fingerprints. */
  customGraphics?: CustomGraphicV1[];
  /** Where each custom graphic is used on the piece. Absent when none is placed. */
  placedGraphics?: PlacedGraphicV1[];
  /** User-authored geographic paths, independent of fetched map-detail toggles. */
  customLines: CustomLineFeatureV1[];
  explodedPreview: number;
}

export interface ElevationGrid {
  width: number;
  height: number;
  values: Float32Array;
  min: number;
  max: number;
}

export interface SourceAttribution {
  name: string;
  url: string;
  license: string;
}

export interface MarkingFeature {
  id: string;
  kind: "road" | "trail" | "water" | "boundary" | "grid" | "contour" | "label" | "guide" | "marker";
  operation: Exclude<Operation, "cut">;
  points: Point2D[];
  label?: string;
  transportationClass?: TransportationClass;
  elevationM?: number;
}

/**
 * A water body with whatever depth metadata its source could supply. Oceans
 * arrive from the OSM water layer and carry no depth - the DEM already holds
 * their bed. Lakes use provider masks, HydroLAKES, or OSM shorelines. Optional
 * GLOBathy parameters and surveyed depth grids provide depth independently
 * of outline availability.
 */
export interface WaterAreaV1 {
  id: string;
  kind: WaterKind;
  polygon: Polygon2D;
  name?: string;
  hylakId?: number;
  outlineSource?: "provider" | "osm";
  outlineSourceId?: string;
  surveyId?: string;
  /** HydroLAKES `Elevation`; the DEM median inside the polygon is the fallback. */
  surfaceElevationM?: number;
  /** GLOBathy `Dmax_use_m`. */
  maxDepthM?: number;
  /** HydroLAKES `Depth_avg`, i.e. `Vol_total / Lake_area`. */
  meanDepthM?: number;
  /**
   * Maximum inscribed-circle radius of the *whole* lake, in meters - the `L` in
   * GLOBathy's `D = l * Dmax / L`. Precomputed at provisioning time because a
   * lake larger than the map window would otherwise normalize against a clipped
   * radius and come out far too shallow.
   */
  lmaxM?: number;
  /** True when the polygon reaches the edge of the fetched window. */
  clipped?: boolean;
  /** Set to "user" once a per-lake override has replaced `maxDepthM`. */
  depthSource?: DepthSource;
  /** Absent means a published survey. A traced chart carves as a user-supplied depth. */
  bathymetryOrigin?: BathymetryOrigin;
  /** Surveyed depths below the dataset reference waterline, aligned to the terrain grid. NaN means no coverage. */
  bathymetry?: {
    width: number;
    height: number;
    depthsM: Float32Array;
    /** Ground spacing of the sampled survey raster, before alignment to terrain. */
    sampleSpacingM?: number;
  };
}

/** Region kinds a paint stencil can be windowed to. Extend here and in the paint-regions source registry. */
export const PAINT_REGION_KINDS = ["water"] as const;
export type PaintRegionKind = (typeof PAINT_REGION_KINDS)[number];

/**
 * One piece polygon's paint windows for a region kind: the part of the region
 * exposed after assembly, extended a small bleed under the layer above. Never
 * stored empty.
 */
export interface PaintRegionIR {
  kind: PaintRegionKind;
  layerIndex: number;
  polygonIndex: number;
  /** The windows: region exposed after assembly plus the bleed under the layer above. */
  polygons: Polygon2D[];
  /**
   * The stencil as cut: the piece less its windows, thin paper bridges opened
   * up. Absent from IR recorded before stencils were merged into one outline.
   */
  paper?: Polygon2D[];
}

export interface WaterSurfaceIR {
  id: string;
  kind: WaterKind;
  name?: string;
  hylakId?: number;
  polygons: Polygon2D[];
  surfaceElevationM: number;
  bedElevationM: number;
  /** Uniform compression applied after the requested depth multiplier; present only when fitted. */
  depthFitScale?: number;
  /** Effective depth multiplier relative to terrain after fitting. */
  appliedDepthExaggeration?: number;
  /** Requested bed elevation before fitting, for export provenance. */
  unfittedBedElevationM?: number;
  /**
   * Real-world maximum depth in metres, after any override but *before*
   * exaggeration - so a control bound to it edits the depth of the actual lake
   * rather than the depth of the drawing.
   */
  maxDepthM?: number;
  /** Layer whose top face the surface sits on. */
  layerIndex: number;
  depthSource: DepthSource;
  /** Set when the floor was carved from a traced depth chart. */
  bathymetryOrigin?: "chart";
}

export interface TerrainSelection {
  policy: "terrain-priority-v1";
  sources: Array<{ id: string; name: string; fraction: number; nativeResolutionM?: number; verticalDatum: string }>;
  attempts: Array<{ id: string; name: string; status: "selected" | "no-coverage" | "unavailable" }>;
}

export interface SourceBundleV1 {
  schemaVersion: 1;
  elevation: ElevationGrid;
  /** Native DEM samples estimated from neighbors after detecting isolated downward spikes. */
  elevationRepairCount?: number;
  /** A registered preferred terrain archive failed; base terrain was retained. */
  terrainSourceUnavailable?: boolean;
  markings: MarkingFeature[];
  waterAreas?: WaterAreaV1[];
  /** OSM water polygons retained independently of depth-modeling metadata. */
  waterPatternAreas?: Polygon2D[];
  /** Inland OSM polygons retained for shoreline fallback and depth retries. */
  inlandWaterAreas?: Polygon2D[];
  vectorStatus: "available" | "partial" | "unavailable" | "not-requested";
  /** Status of the optional HydroLAKES/GLOBathy depth archive. */
  lakeDataStatus: "available" | "unavailable" | "not-requested";
  /** Survey failures retain modeled lake depths and generate a warning. */
  bathymetryStatus?: "available" | "partial" | "unavailable" | "not-covered";
  datasetVersion: string;
  sourceKind: "real" | "preview" | "synthetic";
  bounds: GeoBounds;
  imagerySources: string[];
  terrainSelection?: TerrainSelection;
  resolutionM?: number;
  attribution: SourceAttribution[];
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Ring invariants relied on throughout the geometry engine:
 * - every ring is explicitly closed (first point equals last point exactly);
 * - `outer` is wound positively (counter-clockwise in the mm coordinate
 *   space), `holes` are wound negatively;
 * - coordinates are millimeters centered on the material origin.
 */
export interface Polygon2D {
  outer: Point2D[];
  holes: Point2D[][];
}

export interface OperationPath {
  id: string;
  operation: Exclude<Operation, "cut">;
  kind: MarkingFeature["kind"];
  points: Point2D[];
  label?: string;
  labelRotationRad?: number;
  textStyle?: TextStyleV1;
  transportationClass?: TransportationClass;
  /** Closed engraving paths that should render as solid marker artwork. */
  filled?: boolean;
  /** Interior voids in a filled marking, including areas covered by upper sheets. */
  holes?: Point2D[][];
  /** Paper/material-colored geometry that protects a marker from underlying engravings. */
  knockout?: boolean;
}

/**
 * One physical piece of a split layer. Identity lives here rather than on
 * `Polygon2D` so rings stay pure geometry and every existing index into
 * `LayerIR.polygons` - `FabricationNestCavity.donorPolygonIndex` above all -
 * keeps meaning exactly what it meant before.
 */
export interface LayerPieceV1 {
  /** Index into the owning layer's `polygons`. */
  polygonIndex: number;
  /**
   * Engraved assembly id, e.g. "L03-B2" ("L03-B2-2" for a second component in
   * one cell). Seams are offset on alternating layers, so cell B on an odd
   * layer covers a slightly different span than cell B on an even one; the `Lnn-` prefix is what makes
   * the id unambiguous across the model.
   */
  id: string;
  /** 0-based seam cell. Only comparable within one layer. */
  column: number;
  row: number;
  /** True when the piece was kept whole because its own bounds already fit the work area. */
  exempt: boolean;
  widthMm: number;
  heightMm: number;
}

export interface LayerIR {
  id: string;
  index: number;
  elevationM: number;
  materialThicknessMm: number;
  polygons: Polygon2D[];
  markings: OperationPath[];
  /** Physical pieces this layer is cut as. Empty when the layer is one piece per polygon. */
  pieces: LayerPieceV1[];
}

export interface FabricationNestCavity {
  donorPolygonIndex: number;
  donorHoleIndex: number;
  nestedPolygonIndex: number;
}

export interface FabricationNest {
  id: string;
  donorLayerIndex: number;
  nestedLayerIndex: number;
  glueMarginMm: number;
  cavities: FabricationNestCavity[];
}

/**
 * The seam grid a model is cut along so every piece fits the machine bed.
 * Divisions are equal by construction - `pitch = span / count` - so a split
 * never leaves a full tile beside a sliver remainder.
 */
export interface SeamPlanV1 {
  /** Divisions along x; 1 means the axis is not split. */
  columns: number;
  rows: number;
  pitchXMm: number;
  pitchYMm: number;
  /** Distance between adjacent layers' seams along x; 0 when the axis is not split. */
  seamOffsetXMm: number;
  seamOffsetYMm: number;
  /** Work area less the full kerf: the largest piece bounding box that still fits. */
  usableWidthMm: number;
  usableHeightMm: number;
}

/**
 * One sheet of the fabrication package: a nest family, narrowed to a single
 * seam cell when the model is split. Pieces keep their model coordinates and
 * are placed by a group translate, so the planner still never rotates or
 * translates terrain relative to its neighbours.
 */
export interface FabricationPanelV1 {
  rootLayerIndex: number;
  layerIndexes: number[];
  /** Seam cell whose pieces this panel holds; absent when the project is cut whole. */
  cellName?: string;
  /** Panel content bounding box in model coordinates, kerf included. */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Which rotations sheet nesting may give a part: none, a half turn, quarter
 * turns, or any angle. Parts are never mirrored, since engraving is one-sided.
 */
export type SheetNestRotation = "none" | "half" | "quarter" | "free";

/** Stock sheets and packing effort for sheet nesting, as the maker set them. */
export interface SheetNestSettingsV1 {
  /** Stock sheet size; 0 on an axis uses the machine work area on that axis. */
  sheetWidthMm: number;
  sheetHeightMm: number;
  /** Clearance kept free along every sheet edge. */
  marginMm: number;
  /** Minimum material left between two parts' cut lines. */
  spacingMm: number;
  rotation: SheetNestRotation;
  /** How long the packer may search before settling on its best layout. */
  timeBudgetS: number;
  /** Seed for the packer's random choices, so a rerun on one machine repeats. */
  seed: number;
}

/**
 * One rigid part to lay out: a root polygon of a nest family together with
 * every polygon cut out of it, which share cut lines and so move as one.
 */
export interface NestPartV1 {
  /** `<root layer id>:<root polygon index>`. */
  id: string;
  /** What the maker reads on the sheet map: the piece id, or `L03` / `L03-2`. */
  label: string;
  rootLayerIndex: number;
  members: Array<{ layerIndex: number; polygonIndexes: number[] }>;
  /**
   * Closed, counter-clockwise outer boundary in model millimetres that
   * contains every cut line of the part, kerf included, simplified outward.
   */
  outline: Point2D[];
  areaMm2: number;
}

/**
 * Where a part lands: `sheetPoint = R(rotationDeg) · modelPoint + (xMm, yMm)`,
 * in sheet millimetres with the origin at a sheet corner.
 */
export interface NestPlacementV1 {
  partId: string;
  rotationDeg: number;
  xMm: number;
  yMm: number;
}

export interface SheetNestSheetV1 {
  placements: NestPlacementV1[];
  /** Length of stock the parts use along the sheet width, margin included; the rest is offcut. */
  usedWidthMm: number;
  /** Packed by sparrow, or by the bounding-box fallback. */
  method: "sparrow" | "rectangles";
  /** A stand-in layout for parts the packer has not reached yet. */
  provisional?: boolean;
}

/** Every part of a project laid out on stock sheets. */
export interface SheetNestPlanV1 {
  schemaVersion: 1;
  /** Hash of the parts and settings the plan was made for; a stale plan no longer matches. */
  jobKey: string;
  /** The engine that searched. A sheet it could not improve keeps the bounding-box layout; see each sheet's `method`. */
  engine: { name: "sparrow" | "rectangles"; sparrowRev?: string; jaguaVersion?: string };
  settings: ResolvedSheetNestSettings;
  sheets: SheetNestSheetV1[];
  /** False while the packer is still improving the layout. Draft plans are still valid to cut. */
  final: boolean;
  /** Part area over sheet area across all sheets. */
  utilization: number;
  elapsedMs: number;
}

/** Settings with the work-area fallback applied and every value in range. */
export interface ResolvedSheetNestSettings {
  sheetWidthMm: number;
  sheetHeightMm: number;
  marginMm: number;
  spacingMm: number;
  rotation: SheetNestRotation;
  timeBudgetS: number;
  seed: number;
}

export interface GeometryWarning {
  code: "TERRAIN_SOURCE_FALLBACK" | "ELEVATION_REPAIRED" | "LOW_RELIEF" | "EMPTY_LAYER" | "SMALL_FEATURES" | "DATA_FALLBACK" | "VECTOR_DATA_PARTIAL" | "VECTOR_DATA_UNAVAILABLE" | "LAKE_DATA_UNAVAILABLE" | "BATHYMETRY_FALLBACK" | "LAKE_DEPTH_PREDICTED" | "LAKE_DEPTH_FROM_CHART" | "LABEL_OMITTED" | "WATER_DEPTH_CLAMPED" | "WORK_AREA_OVERSIZE" | "WORK_AREA_UNSPLIT" | "GRAPHIC_LOOSE_PIECES" | "SEAM_TABS_OMITTED" | "PAINT_WINDOWS_OMITTED";
  message: string;
  action?: "fit-lake-depth";
}

export interface GeometryIRV1 {
  schemaVersion: 1;
  projectId: string;
  projectName: string;
  units: UnitSystem;
  configFingerprint: string;
  sourceKind: SourceBundleV1["sourceKind"];
  vectorStatus: SourceBundleV1["vectorStatus"];
  lakeDataStatus: SourceBundleV1["lakeDataStatus"];
  datasetVersion: string;
  bounds: GeoBounds;
  resolutionM?: number;
  imagerySources: string[];
  terrainSelection?: TerrainSelection;
  widthMm: number;
  heightMm: number;
  laserKerfMm: number;
  lineStyle: LineStyleV1;
  verticalExaggeration: number;
  /**
   * Model length over ground length across the mapped width (1/78247 for the
   * bundled preview); 0 when the bounds have no usable width. Optional so IR
   * produced before it was recorded still renders.
   */
  horizontalScale?: number;
  minElevationM: number;
  maxElevationM: number;
  /** Relief of the land alone - what the sheet budget is sized from. */
  landReliefM: number;
  /** How far the deepest water reaches below the land minimum. */
  waterDepthBelowLandM: number;
  layers: LayerIR[];
  waterSurfaces: WaterSurfaceIR[];
  /** Crop-clipped water polygons used by optional flat-engraving fills. */
  waterPatternAreas: Polygon2D[];
  fabricationNests: FabricationNest[];
  /** Paint stencil windows per piece; optional so IR recorded before it still renders. */
  paintRegions?: PaintRegionIR[];
  /** Present only when a machine work area split the layers. */
  splitPlan?: SeamPlanV1;
  warnings: GeometryWarning[];
  attribution: SourceAttribution[];
  generatedAt: string;
}

export interface ExportFile {
  filename: string;
  blob: Blob;
}

export interface FabricationPackageV1 {
  schemaVersion: 1;
  files: ExportFile[];
  /** Convenience pointer to the master-layout SVG; the same file is also present in `files`. */
  master: ExportFile;
}

export const DEFAULT_PROJECT: ProjectConfigV1 = {
  schemaVersion: 1,
  id: "topostack-demo",
  name: "Crater Lake",
  location: { lat: 42.9446, lon: -122.109, label: "Crater Lake, Oregon", zoom: 11 },
  cropShape: "rectangle",
  units: "metric",
  outputMode: "stack",
  widthMm: 300,
  heightMm: 200,
  engravingContourCount: 12,
  engravingIndexInterval: 5,
  showEngravingBorder: true,
  lineStyle: { ...DEFAULT_LINE_STYLE },
  materialThicknessMm: 3,
  verticalExaggeration: 2,
  minimumFeatureMm: 0.8,
  smoothing: 1,
  showRoads: true,
  showTrails: true,
  showTransportationLabels: false,
  showWater: true,
  waterFillPattern: "none",
  showBoundaries: false,
  showCoordinateGrid: false,
  showWaterDepth: true,
  waterDepthExaggeration: 1,
  fitLakeDepth: false,
  waterDepthOverrides: {},
  showAlignmentGuides: true,
  optimizeMaterialUse: true,
  glueMarginMm: 8,
  laserKerfMm: 0.15,
  workAreaWidthMm: 0,
  workAreaHeightMm: 0,
  seamOffsetMm: 10,
  seamTabs: true,
  showAssemblyLabels: true,
  paintTemplates: [],
  showElevationLabels: true,
  elevationLabelPosition: { x: -0.55, y: 0.55 },
  textStyle: { ...DEFAULT_TEXT_STYLE },
  showNorthArrow: true,
  northArrowStyle: "classic",
  northArrowSizeMm: 24,
  northArrowPlacement: { anchor: "bottom-right", offset: { x: 0, y: 0 } },
  showScaleBar: true,
  markers: [],
  customLines: [],
  explodedPreview: 0.35,
};
