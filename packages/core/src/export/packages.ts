import { ASSEMBLY, CUT, ENGRAVE, EXPORT_CREDIT, MAX_EXPORT_PACKAGE_BYTES, SCORE, safeName } from "./svg-primitives.js";
import { ENGRAVE_ONLY, OPERATIONS, masterToSvg, paintTemplateSvg, panelBodies, panelToSvg } from "./svg.js";
import { fabricationPanels } from "./panel-layout.js";
import { engravingToSvg } from "./engraving-svg.js";
import { assemblyGuideToHtml, type GuideFont, type GuideSheetMap } from "./assembly-guide.js";
import { exportBlockReason } from "./export-policy.js";
import { formatNumber as format } from "../primitives/format.js";
import { ringBounds } from "../primitives/geometry2d.js";
import { horizontalScaleFor } from "../pipeline/stack-plan.js";
import { displayLength, lengthUnit } from "../primitives/units.js";
import { PAINT_BLEED_MM } from "../pipeline/paint-regions.js";
import { alignmentOutlineInsetMm } from "../pipeline/hidden-marks.js";
import { aviationRequested, aviationStroke } from "../pipeline/aviation.js";
import type { ExportFile, FabricationPackageV1, GeometryIRV1, LineStyleV1, Point2D, ProjectConfigV1, SheetNestPlanV1 } from "../types.js";
import { nestableParts, polygonLabel } from "./sheet-nest/parts.js";
import { resolveSheetNestSettings, type SheetNestSettingsResult } from "./sheet-nest/resolve.js";
import { acrylicGeometry, acrylicPanels, acrylicWoodLayers, resolveAcrylicNestSettings } from "./water-inserts.js";
import { AIRSPACE_TINT_NAMES, airspaceAcrylicArea, airspaceGeometry, airspaceLayers, airspacePanels, backingGeometry, backingPanels } from "./airspace.js";
import type { GuideAirspace } from "./assembly-guide-airspace.js";
import { sheetNestJobKey } from "./sheet-nest/job-key.js";
import { verifySheetPlan } from "./sheet-nest/verify.js";
import { withPartLabels } from "./sheet-nest/part-labels.js";
import { nestedSheets, type NestedSheet } from "./sheet-nest/apply.js";
import { nestedPaintTemplateSvg, nestedSheetBodies } from "./sheet-nest/sheet-svg.js";
import { transformPoints } from "./sheet-nest/transform.js";
import type { FabricationPanel } from "./panel-layout.js";


function roadAppearance(style: LineStyleV1): string {
  return style.roadStyle === "centerline" ? "centerlines" : `outlined major roads spaced ${format(style.majorRoadSpacingMm)} mm`;
}

/** README line for road style and line widths; map-detail widths are shared, `leading`/`trailing` are output-specific. */
function lineworkSummary(style: LineStyleV1, heading: string, leading: string[], trailing: string[]): string {
  const widths = [
    ...leading,
    `major roads ${format(style.majorRoadMm)} mm`, `local roads ${format(style.localRoadMm)} mm`, `trails ${format(style.trailMm)} mm (${style.trailPattern})`,
    `water ${format(style.waterMm)} mm`, `state/province boundaries ${format(style.boundaryMm)} mm (dashed)`, `latitude/longitude grid ${format(style.coordinateGridMm)} mm (dotted)`,
    ...trailing,
  ];
  return `Road appearance: ${roadAppearance(style)}, ${style.roadCap} endpoints. ${heading}: ${widths.join(", ")}.\n`;
}

/**
 * README paragraph for FAA aviation detail: what was drawn, how each class
 * looks in a single colour, and which cycle it came from. Empty when the
 * project has none.
 */
function aviationSummary(ir: GeometryIRV1, config: ProjectConfigV1): string {
  if (!aviationRequested(config)) return "";
  const details = config.aviation!;
  const width = format(aviationStroke("class-c", config.lineStyle).widthMm);
  const drawn = [
    details.airspace ? `Class B airspace ${format(aviationStroke("class-b", config.lineStyle).widthMm)} mm (solid), Class C ${width} mm (solid), Class D ${width} mm (dashed)` : "",
    details.specialUse ? `special use airspace ${width} mm (solid, hatched on the inside)` : "",
    details.runways ? `runways ${width} mm (outlined where wide enough at this scale)` : "",
    details.airports ? "airports" : "", details.navaids ? "navaids" : "", details.obstacles ? "obstacles 200 ft AGL and taller" : "",
    details.labels && (details.airports || details.navaids) ? "identifiers" : "",
  ].filter(Boolean);
  const source = ir.aviationStatus === "not-covered"
    ? "FAA data covers only the United States and its territories, so this area has none."
    : `Source: FAA Aeronautical Information Services${ir.aviationCycle ? `, NASR cycle effective ${ir.aviationCycle}` : ""}.`;
  const symbols = details.airports || details.navaids || details.obstacles
    ? " Symbols follow the FAA VFR sectional legend in one colour, so towered airports, which the chart shows in blue, look like the rest."
    : "";
  return `Aviation detail: ${drawn.join(", ")}.${symbols} ${source} NOT FOR NAVIGATION: aeronautical data is replaced every 28 days and this piece is never updated.\n`;
}

function attributionText(ir: GeometryIRV1): string {
  return `${ir.attribution.map((item) => `${item.name} — ${item.license}\n${item.url}`).join("\n\n")}\n\nImagery sources used:\n${ir.imagerySources.length ? ir.imagerySources.join("\n") : "Not reported by source service"}`;
}

/** Optional inputs the core cannot fetch itself. */
export interface PackageOptions {
  /** Fonts embedded in the assembly guide; system fonts are used without them. */
  guideFonts?: readonly GuideFont[];
  /**
   * Lay the parts out on stock sheets as this plan says, instead of one panel
   * per nest family. It must have been made for this geometry and the
   * project's current sheet settings, or the export is refused.
   */
  sheetPlan?: SheetNestPlanV1;
  /**
   * Lay the acrylic water inserts out on acrylic stock sheets as this plan
   * says, under the same rules as `sheetPlan` but against the project's
   * acrylic sheet settings.
   */
  acrylicSheetPlan?: SheetNestPlanV1;
}

/**
 * The plan checked against the geometry it is applied to, and the IR with
 * part ids engraved when `labels` names the project. Acrylic passes none:
 * clear plastic shows every mark, so its pieces are named in the guide only.
 */
function nestedLayout(ir: GeometryIRV1, resolved: SheetNestSettingsResult, plan: SheetNestPlanV1, labels?: ProjectConfigV1, material = "sheet"): NestedLayout {
  if (!resolved.ok) throw new Error(resolved.error);
  const parts = nestableParts(ir);
  if (sheetNestJobKey(parts, resolved.settings) !== plan.jobKey) throw new Error(`The ${material} layout is out of date. Nest the parts again, or export the original panels.`);
  const problems = verifySheetPlan(parts, plan);
  if (problems.length) throw new Error(`The ${material} layout is not valid: ${problems[0]}`);
  const labelled = labels ? withPartLabels(ir, labels, parts) : { ir, omitted: [] };
  return { plan, ir: labelled.ir, sheets: nestedSheets(labelled.ir, parts, plan), omittedLabels: labelled.omitted };
}

interface NestedLayout {
  plan: SheetNestPlanV1;
  ir: GeometryIRV1;
  sheets: NestedSheet[];
  omittedLabels: string[];
}

/** README paragraph for a nested export: what moved, how to tell pieces apart, and whose solver did it. */
function sheetNestingText(nested: NestedLayout, shownLength: (valueMm: number) => string): string {
  const { settings, engine } = nested.plan;
  const parts = nested.sheets.reduce((total, sheet) => total + sheet.parts.length, 0);
  const rotation = { none: "never rotated", half: "turned by half turns at most", quarter: "turned in quarter turns", free: "turned to any angle" }[settings.rotation];
  const omitted = nested.omittedLabels;
  const ids = omitted.length
    ? `${omitted.length} piece${omitted.length === 1 ? " has" : "s have"} no covered room for an id (${omitted.slice(0, 4).join(", ")}${omitted.length > 4 ? ", ..." : ""}); find ${omitted.length === 1 ? "it" : "them"} on the sheet maps in the assembly guide.`
    : "Pieces without an engraved id are named on the sheet maps in the assembly guide.";
  const solver = nested.plan.sheets.some((sheet) => sheet.method === "sparrow")
    ? "Layouts were packed with sparrow (MIT, Jeroen Gardeyn, KU Leuven; https://github.com/JeroenGar/sparrow) on the jagua-rs collision engine (MPL-2.0; https://github.com/JeroenGar/jagua-rs)."
    : engine.name === "sparrow" ? "sparrow found no tighter layout than packing the pieces by their bounding boxes, so that layout was kept." : "Layouts were packed by bounding boxes.";
  return `Sheet nesting laid the ${parts} pieces out on ${nested.sheets.length} stock sheet${nested.sheets.length === 1 ? "" : "s"} of ${shownLength(settings.sheetWidthMm)} x ${shownLength(settings.sheetHeightMm)}, keeping ${shownLength(settings.marginMm)} clear along every edge and at least ${shownLength(settings.spacingMm)} of material between pieces. Pieces were moved and ${rotation}, never mirrored. Pieces from different layers share a sheet, so each carries its id (layer number, plus island number or seam cell) engraved in green where the layer above hides it. ${ids} A smaller piece cut from inside a larger one stays in place inside it. ${solver}\n\n`;
}

/** Every piece on one sheet, placed as the sheet SVG places it, for the guide's drawing. */
function sheetMap(ir: GeometryIRV1, sheet: NestedSheet): GuideSheetMap {
  return {
    widthMm: sheet.panel.maxX - sheet.panel.minX,
    heightMm: sheet.panel.maxY - sheet.panel.minY,
    pieces: sheet.parts.flatMap(({ part, placement }) => {
      const place = (ring: Point2D[]) => transformPoints(ring, { rotationDeg: placement.rotationDeg, x: placement.xMm, y: placement.yMm });
      return part.members.flatMap(({ layerIndex, polygonIndexes }) => polygonIndexes.flatMap((polygonIndex) => {
        const polygon = ir.layers[layerIndex]?.polygons[polygonIndex];
        return polygon ? [{ label: polygonLabel(ir, layerIndex, polygonIndex), layerIndex, polygon: { outer: place(polygon.outer), holes: polygon.holes.map(place) } }] : [];
      }));
    }),
  };
}

/**
 * The acrylic share of a fabrication package: one panel per wood layer that
 * holds inserts (or one per stock sheet when nested), their engraving-only
 * companions and an acrylic master, plus what the manifest, README and guide
 * say about them. Undefined when the model has no inserts, which leaves every
 * other file exactly as it was.
 */
function acrylicFiles(generated: GeometryIRV1, config: ProjectConfigV1, base: string, plan?: SheetNestPlanV1) {
  const acrylic = acrylicGeometry(generated);
  const material = generated.waterInsertMaterial;
  if (!acrylic || !material) return undefined;
  const woodLayers = acrylicWoodLayers(generated);
  const nested = plan ? nestedLayout(acrylic, resolveAcrylicNestSettings(config), plan, undefined, "acrylic sheet") : undefined;
  const panels: FabricationPanel[] = nested ? nested.sheets.map((sheet) => sheet.panel) : acrylicPanels(generated, acrylic, config);
  const bodies = nested ? nested.sheets.map((sheet) => nestedSheetBodies(acrylic, sheet)) : panels.map((panel) => panelBodies(acrylic, panel));
  const panelFiles = panels.map((panel, index) => {
    const filename = nested ? `${base}-acrylic-sheet-${String(index + 1).padStart(2, "0")}.svg`
      : `${base}-${acrylic.layers[panel.rootLayerIndex]!.id}${panel.cellName ? `-${panel.cellName.toLowerCase()}` : ""}.svg`;
    const insertIds = panel.layerIndexes.flatMap((layerIndex) => {
      const layer = acrylic.layers[layerIndex]!;
      const included = panel.included?.get(layerIndex);
      return layer.pieces.filter((piece) => !included || included.has(piece.polygonIndex)).map((piece) => piece.id);
    });
    return {
      panel,
      insertIds,
      file: { filename, blob: new Blob([panelToSvg(acrylic, panel, bodies[index]!, OPERATIONS, "acrylic")], { type: "image/svg+xml" }) } satisfies ExportFile,
      engravingFile: { filename: filename.replace(/\.svg$/, "-engrave.svg"), blob: new Blob([panelToSvg(acrylic, panel, bodies[index]!, ENGRAVE_ONLY, "acrylic engraving")], { type: "image/svg+xml" }) } satisfies ExportFile,
    };
  });
  const master: ExportFile = { filename: `${base}-acrylic-master.svg`, blob: new Blob([masterToSvg(acrylic, panels, bodies)], { type: "image/svg+xml" }) };
  const inserts = generated.waterInserts ?? [];
  const engraved = acrylic.layers.some((layer) => layer.markings.some((mark) => !mark.knockout));
  const proudMm = material.thicknessMm - config.materialThicknessMm;
  return {
    files: panelFiles.flatMap(({ file, engravingFile }) => [file, engravingFile]),
    master,
    guide: {
      thicknessMm: material.thicknessMm,
      ledgeMm: material.ledgeMm,
      inserts,
      sheets: panelFiles.map(({ panel, file, insertIds }) => ({
        filename: file.filename,
        insertIds,
        ...(nested ? { map: sheetMap(acrylic, nested.sheets[panel.sheetIndex!]!) } : {}),
      })),
      ...(nested ? { sheetSize: { widthMm: nested.plan.settings.sheetWidthMm, heightMm: nested.plan.settings.sheetHeightMm } } : {}),
    },
    manifest: {
      thicknessMm: material.thicknessMm,
      kerfMm: material.kerfMm,
      fitClearanceMm: material.fitClearanceMm,
      ledgeMm: material.ledgeMm,
      master: master.filename,
      inserts: inserts.map((insert) => {
        const bounds = ringBounds(insert.polygons.flatMap((polygon) => polygon.outer));
        return { id: insert.id, lakeKey: insert.lakeKey, name: insert.name, layerId: generated.layers[insert.layerIndex]?.id, widthMm: bounds.maxX - bounds.minX, heightMm: bounds.maxY - bounds.minY };
      }),
      panels: panelFiles.map(({ panel, file, engravingFile, insertIds }, index) => ({
        ...(nested ? { sheet: index + 1, usedWidthMm: nested.sheets[index]!.sheet.usedWidthMm } : {}),
        filename: file.filename,
        engravingFilename: engravingFile.filename,
        insertIds,
        widthMm: panel.maxX - panel.minX,
        heightMm: panel.maxY - panel.minY,
        layerIds: panel.layerIndexes.map((layerIndex) => generated.layers[woodLayers[layerIndex]!]?.id).filter(Boolean),
        ...(nested ? {
          parts: nested.sheets[index]!.parts.map(({ part, placement }) => ({ partId: part.id, label: part.label, rotationDeg: placement.rotationDeg, xMm: placement.xMm, yMm: placement.yMm })),
        } : {}),
      })),
      ...(nested ? { sheetNesting: { engine: nested.plan.engine, settings: nested.plan.settings, sheetCount: nested.sheets.length, utilization: nested.plan.utilization, elapsedMs: nested.plan.elapsedMs } } : {}),
    },
    readme: (shownLength: (valueMm: number) => string) => {
      const count = inserts.length;
      const fit = proudMm > 1e-6 ? `It is ${shownLength(proudMm)} thicker than the wood, so the water stands proud of its shore.` : proudMm < -1e-6 ? `It is ${shownLength(-proudMm)} thinner than the wood, so the water sits just below its shore.` : "It matches the wood, so the water sits flush with its shore.";
      const sheets = nested ? `laid out on ${panels.length} acrylic stock sheet${panels.length === 1 ? "" : "s"} of ${shownLength(nested.plan.settings.sheetWidthMm)} x ${shownLength(nested.plan.settings.sheetHeightMm)} (-acrylic-sheet-NN.svg)` : `on ${panels.length} acrylic panel${panels.length === 1 ? "" : "s"} (-acrylic-NN.svg, named after the wood layer each insert sits in)`;
      return `Acrylic water inserts: ${count} piece${count === 1 ? "" : "s"} (${inserts.map((insert) => insert.name ? `${insert.id} ${insert.name}` : insert.id).join(", ")}) of ${shownLength(material.thicknessMm)} acrylic replace${count === 1 ? "s" : ""} the water on the sheet that carries each lake's waterline. ${fit} Cut them ${sheets}, with ${base}-acrylic-master.svg holding them all; they are a separate job with your acrylic settings, never the wood's. Their CUT paths carry ${shownLength(material.kerfMm)} of acrylic kerf compensation and are ${shownLength(material.fitClearanceMm)} smaller than the wood opening on every side, so each insert drops in without forcing; if one is tight or loose, adjust Acrylic kerf or Fit clearance and export again. ${engraved ? "Map detail that crosses the water is engraved on the acrylic's top face (not mirrored), in the -engrave.svg companions or the complete panels. " : ""}Cast acrylic cuts and engraves cleanest; leave its protective film on while cutting. Inserts carry no engraved ids, since clear acrylic shows every mark: the assembly guide names each one. The sheet below each opening has a ${shownLength(material.ledgeMm)} wood ledge for the insert to rest on. Glue with a few dots of clear, acrylic-safe glue on that ledge, not cyanoacrylate (superglue), which fogs acrylic with a white haze. Peel the top film last.\n\n`;
    },
  };
}

/**
 * The airspace share of a fabrication package (docs/plans/airspace-acrylic.md):
 * one panel per level and tint, their engraving-only companions, a master per
 * tint, the backing sheet when sockets go through the bottom sheet, and what
 * the manifest, README and guide say about them. Undefined without an airspace
 * stack, which leaves every other file exactly as it was.
 */
function airspaceFiles(generated: GeometryIRV1, config: ProjectConfigV1, base: string) {
  const stack = generated.airspaceStack;
  const airspace = airspaceGeometry(generated);
  if (!stack || !airspace) return undefined;
  const layers = airspaceLayers(stack, { markings: false });
  const panels = airspacePanels(airspace, config);
  const bodies = panels.map((panel) => panelBodies(airspace, panel));
  const panelFiles = panels.map((panel, index) => {
    const layer = airspace.layers[panel.rootLayerIndex]!;
    const filename = `${base}-${layer.id}${panel.cellName ? `-${panel.cellName.toLowerCase()}` : ""}.svg`;
    const included = panel.included?.get(panel.rootLayerIndex);
    return {
      panel,
      tint: layers[panel.rootLayerIndex]!.tint,
      levelIndex: layers[panel.rootLayerIndex]!.levelIndex,
      pieceIds: [...new Set(layer.pieces.filter((piece) => !included || included.has(piece.polygonIndex)).map((piece) => piece.id))],
      file: { filename, blob: new Blob([panelToSvg(airspace, panel, bodies[index]!, OPERATIONS, "airspace")], { type: "image/svg+xml" }) } satisfies ExportFile,
      engravingFile: { filename: filename.replace(/\.svg$/, "-engrave.svg"), blob: new Blob([panelToSvg(airspace, panel, bodies[index]!, ENGRAVE_ONLY, "airspace engraving")], { type: "image/svg+xml" }) } satisfies ExportFile,
    };
  });
  const tints = [...new Set(panelFiles.map((entry) => entry.tint))];
  const masters: ExportFile[] = tints.map((tint) => {
    const own = panelFiles.flatMap((entry, index) => (entry.tint === tint ? [index] : []));
    return { filename: `${base}-airspace-${tint}-master.svg`, blob: new Blob([masterToSvg(airspace, own.map((index) => panels[index]!), own.map((index) => bodies[index]!))], { type: "image/svg+xml" }) };
  });
  const backing = backingGeometry(generated);
  const backingFiles: ExportFile[] = backing ? backingPanels(backing).map((panel) => ({
    filename: `${base}-airspace-backing${panel.cellName ? `-${panel.cellName.toLowerCase()}` : ""}.svg`,
    blob: new Blob([panelToSvg(backing, panel, panelBodies(backing, panel), OPERATIONS, "backing")], { type: "image/svg+xml" }),
  })) : [];
  const segments = stack.columns.flatMap((column) => column.segments);
  const rodTotalMm = segments.reduce((total, segment) => total + segment.lengthMm, 0);
  const pieceCount = stack.levels.reduce((total, level) => total + level.pieces.length, 0);
  const stock = airspaceAcrylicArea(stack);
  const guide: GuideAirspace = {
    form: stack.form,
    thicknessMm: stack.thicknessMm,
    rod: stack.rod,
    cutList: stack.cutList,
    rodTotalMm,
    backingFilenames: backingFiles.map((file) => file.filename),
    stock,
    ...(generated.aviationCycle ? { cycle: generated.aviationCycle } : {}),
    levels: stack.levels.map((level) => ({
      level,
      files: panelFiles.filter((entry) => entry.levelIndex === level.index).map((entry) => entry.file.filename),
    })),
    columns: stack.columns,
  };
  return {
    files: [...panelFiles.flatMap(({ file, engravingFile }) => [file, engravingFile]), ...masters, ...backingFiles],
    guide,
    manifest: {
      form: stack.form,
      thicknessMm: stack.thicknessMm,
      kerfMm: stack.kerfMm,
      ceilingCapFt: stack.ceilingCapFt,
      mmPerMeter: stack.mmPerMeter,
      topMm: stack.topMm,
      ...(generated.aviationCycle ? { nasrCycle: generated.aviationCycle } : {}),
      masters: masters.map((file) => file.filename),
      backingSheet: backingFiles.map((file) => file.filename),
      levels: stack.levels.map((level) => ({
        index: level.index,
        altitudeFt: level.altitudeFt,
        mergedFt: level.mergedFt,
        zMm: level.zMm,
        pieces: level.pieces.map((piece) => {
          const bounds = ringBounds(piece.polygons.flatMap((polygon) => polygon.outer));
          return { id: piece.id, tint: piece.tint, sectorIds: piece.sectorIds, widthMm: bounds.maxX - bounds.minX, heightMm: bounds.maxY - bounds.minY, ...(piece.resting ? { resting: true } : {}) };
        }),
      })),
      panels: panelFiles.map(({ panel, file, engravingFile, pieceIds, tint, levelIndex }) => ({
        filename: file.filename, engravingFilename: engravingFile.filename, tint, levelIndex, pieceIds,
        widthMm: panel.maxX - panel.minX, heightMm: panel.maxY - panel.minY,
      })),
      rod: stack.rod,
      cutList: stack.cutList,
      columns: stack.columns,
    },
    readme: (shownLength: (valueMm: number) => string) => {
      const tintText = (Object.keys(stock) as Array<keyof typeof stock>).map((tint) => `${AIRSPACE_TINT_NAMES[tint]}`).join(", ");
      const rods = segments.length
        ? `${segments.length} rod segment${segments.length === 1 ? "" : "s"} hold them up: ${shownLength(stack.rod.sizeMm)} ${stack.rod.shape} rod of any material, cut to ${stack.cutList.length} length${stack.cutList.length === 1 ? "" : "s"} (${shownLength(rodTotalMm)} in all; the assembly guide lists each length and where it goes). Each piece has the rods it rests on engraved as outlines on its top face. Sockets for the lowest rods are cut into the terrain sheets, ${shownLength(stack.rod.fitClearanceMm)} wider than the rod on every side. `
        : "";
      const backingText = backingFiles.length ? `Some sockets go through the bottom sheet: glue the backing sheet (${backingFiles.map((file) => file.filename).join(", ")}) under the model so those rods stand on it. ` : "";
      return `Airspace in acrylic (${stack.form}): ${pieceCount} piece${pieceCount === 1 ? "" : "s"} on ${stack.levels.length} level${stack.levels.length === 1 ? "" : "s"} of ${shownLength(stack.thicknessMm)} ${tintText} acrylic, at true height over the terrain. Cut them from the -airspace-<tint>-NN.svg panels (NN is the level, lowest first), with a master per tint; they are a separate job with your acrylic settings, never the wood's. Their CUT paths carry ${shownLength(stack.kerfMm)} of acrylic kerf compensation. Frosted shelves, sector edges and rod outlines are engraved on each piece's top face (not mirrored). Pieces carry no engraved ids, since clear acrylic shows every mark: the assembly guide names each one. ${rods}${backingText}Glue acrylic with a clear, acrylic-safe glue, not cyanoacrylate (superglue), which fogs it white. The airspace shown is from FAA data${generated.aviationCycle ? ` of the ${generated.aviationCycle} cycle` : ""} and is not for navigation.\n\n`;
    },
  };
}

export function buildFabricationPackage(generated: GeometryIRV1, config: ProjectConfigV1, options: PackageOptions = {}): FabricationPackageV1 {
  const unlabelled = { ...generated, projectId: config.id, projectName: config.name };
  if (config.outputMode !== "stack") throw new Error("Choose layered relief before exporting fabrication files.");
  const reason = exportBlockReason(unlabelled, config);
  if (reason) throw new Error(reason);
  const base = safeName(config.name);
  const nested = options.sheetPlan ? nestedLayout(unlabelled, resolveSheetNestSettings(config), options.sheetPlan, config) : undefined;
  const ir = nested?.ir ?? unlabelled;
  const panels: FabricationPanel[] = nested ? nested.sheets.map((sheet) => sheet.panel) : fabricationPanels(ir);
  const bodies = nested ? nested.sheets.map((sheet) => nestedSheetBodies(ir, sheet)) : panels.map((panel) => panelBodies(ir, panel));
  const panelFiles = panels.map((panel, index) => {
    const layers = panel.layerIndexes.map((layerIndex) => ir.layers[layerIndex]?.id.replace("layer-", "")).filter(Boolean).join("-");
    const cell = panel.cellName ? `-${panel.cellName.toLowerCase()}` : "";
    const filename = nested ? `${base}-sheet-${String(index + 1).padStart(2, "0")}.svg`
      : panel.layerIndexes.length === 1 ? `${base}-${ir.layers[panel.rootLayerIndex]?.id}${cell}.svg` : `${base}-panel-${String(index + 1).padStart(2, "0")}-layers-${layers}${cell}.svg`;
    const engravingFilename = filename.replace(/\.svg$/, "-engrave.svg");
    const paintTemplates = config.paintTemplates.flatMap((kind) => {
      const svg = nested ? nestedPaintTemplateSvg(ir, config, nested.sheets[index]!, kind) : paintTemplateSvg(ir, config, panel, kind);
      return svg ? [{ kind, file: { filename: filename.replace(/\.svg$/, `-paint-${kind}.svg`), blob: new Blob([svg], { type: "image/svg+xml" }) } satisfies ExportFile }] : [];
    });
    const paintFiles = paintTemplates.map((template) => template.file);
    return {
      panel,
      file: { filename, blob: new Blob([panelToSvg(ir, panel, bodies[index]!, OPERATIONS, "fabrication")], { type: "image/svg+xml" }) } satisfies ExportFile,
      engravingFile: { filename: engravingFilename, blob: new Blob([panelToSvg(ir, panel, bodies[index]!, ENGRAVE_ONLY, "engraving")], { type: "image/svg+xml" }) } satisfies ExportFile,
      paintFiles,
      paintTemplates,
    };
  });
  // A split layer is cut across several sheets, so a layer maps to a list.
  const filenamesByLayer = new Map<number, string[]>();
  panelFiles.forEach(({ panel, file }) => panel.layerIndexes.forEach((layerIndex) => {
    filenamesByLayer.set(layerIndex, [...(filenamesByLayer.get(layerIndex) ?? []), file.filename]);
  }));
  const master: ExportFile = { filename: `${base}-master.svg`, blob: new Blob([masterToSvg(ir, panels, bodies)], { type: "image/svg+xml" }) };
  const acrylic = acrylicFiles(unlabelled, config, base, options.acrylicSheetPlan);
  const airspace = airspaceFiles(unlabelled, config, base);
  const manifest = {
    schemaVersion: 1,
    project: config,
    result: {
      projectId: ir.projectId,
      generatedAt: ir.generatedAt,
      minElevationM: ir.minElevationM,
      maxElevationM: ir.maxElevationM,
      layers: ir.layers.map((layer) => ({
        id: layer.id,
        elevationM: layer.elevationM,
        filename: filenamesByLayer.get(layer.index)?.[0],
        filenames: filenamesByLayer.get(layer.index) ?? [],
        pieces: layer.pieces,
      })),
      fabrication: {
        panelCount: panels.length,
        originalPanelCount: ir.layers.length,
        workArea: ir.splitPlan ? {
          widthMm: config.workAreaWidthMm,
          heightMm: config.workAreaHeightMm,
          columns: ir.splitPlan.columns,
          rows: ir.splitPlan.rows,
          pitchXMm: ir.splitPlan.pitchXMm,
          pitchYMm: ir.splitPlan.pitchYMm,
          seamOffsetXMm: ir.splitPlan.seamOffsetXMm,
          seamOffsetYMm: ir.splitPlan.seamOffsetYMm,
          pieceCount: ir.layers.reduce((total, layer) => total + layer.pieces.length, 0),
        } : undefined,
        glueMarginMm: config.glueMarginMm,
        laserKerfMm: config.laserKerfMm,
        nests: ir.fabricationNests,
        paintTemplates: config.paintTemplates.length ? {
          kinds: config.paintTemplates,
          bleedMm: PAINT_BLEED_MM,
          fileCount: panelFiles.reduce((total, { paintFiles }) => total + paintFiles.length, 0),
        } : undefined,
        ...(acrylic ? { waterInserts: acrylic.manifest } : {}),
        ...(airspace ? { airspaceStack: airspace.manifest } : {}),
        sheetNesting: nested ? {
          engine: nested.plan.engine,
          settings: nested.plan.settings,
          sheetCount: nested.sheets.length,
          partCount: nested.sheets.reduce((total, sheet) => total + sheet.parts.length, 0),
          utilization: nested.plan.utilization,
          elapsedMs: nested.plan.elapsedMs,
        } : undefined,
        panels: panelFiles.map(({ panel, file, engravingFile, paintFiles }, index) => ({
          ...(nested ? { sheet: index + 1, usedWidthMm: nested.sheets[index]!.sheet.usedWidthMm } : {}),
          filename: file.filename,
          engravingFilename: engravingFile.filename,
          paintTemplateFilenames: paintFiles.map((paintFile) => paintFile.filename),
          cell: panel.cellName,
          widthMm: panel.maxX - panel.minX,
          heightMm: panel.maxY - panel.minY,
          layerIds: panel.layerIndexes.map((index) => ir.layers[index]?.id).filter(Boolean),
          ...(nested ? {
            parts: nested.sheets[index]!.parts.map(({ part, placement }) => ({
              partId: part.id,
              label: part.label,
              layerIds: part.members.map((member) => ir.layers[member.layerIndex]?.id).filter(Boolean),
              rotationDeg: placement.rotationDeg,
              xMm: placement.xMm,
              yMm: placement.yMm,
            })),
          } : {}),
        })),
      },
      bounds: ir.bounds,
      resolutionM: ir.resolutionM,
      datasetVersion: ir.datasetVersion,
      warnings: ir.warnings,
      vectorStatus: ir.vectorStatus,
      ...(ir.aviationStatus ? { aviationStatus: ir.aviationStatus } : {}),
      ...(ir.aviationCycle ? { aviationCycle: ir.aviationCycle } : {}),
      lakeDataStatus: ir.lakeDataStatus,
      lakeDepths: ir.waterSurfaces.filter((surface) => surface.kind === "lake").map((surface) => ({
        id: surface.id, name: surface.name, hylakId: surface.hylakId,
        depthSource: surface.depthSource, surfaceElevationM: surface.surfaceElevationM,
        bedElevationM: surface.bedElevationM, unfittedBedElevationM: surface.unfittedBedElevationM,
        depthFitScale: surface.depthFitScale ?? 1,
        appliedDepthExaggeration: surface.appliedDepthExaggeration ?? config.waterDepthExaggeration,
      })),
      imagerySources: ir.imagerySources,
      terrainSelection: ir.terrainSelection,
    },
    attribution: ir.attribution,
  };
  const attribution = attributionText(ir);
  const cutUnit = lengthUnit(config.units);
  const shownLength = (valueMm: number) => `${format(displayLength(valueMm, config.units))} ${cutUnit}`;
  const alignment = config.showAlignmentGuides ? `Each lower layer includes an engraved outline of the layer directly above it, its centre line ${shownLength(alignmentOutlineInsetMm(config))} inside that layer's edge so the whole line stays hidden, plus an Lxx label. These marks are designed to be hidden after assembly.\n\n` : "";
  const kerf = config.laserKerfMm > 0 ? `CUT paths include ${shownLength(config.laserKerfMm)} total kerf compensation: external cuts move outward and internal cuts move inward by half the kerf. Calibrate this value for your laser and material.\n\n` : "CUT paths have no kerf compensation. Calibrate your laser and material before fabrication.\n\n";
  // Layer count is derived, so the README states the scale relationship it came from.
  const horizontalScale = ir.horizontalScale ?? horizontalScaleFor(ir.widthMm, ir.bounds);
  const scale = horizontalScale > 0 ? ` (horizontal scale 1:${Math.round(1 / horizontalScale).toLocaleString("en-US")})` : "";
  const fittedDepths = ir.waterSurfaces.filter((surface) => surface.depthFitScale !== undefined)
    .map((surface) => `${surface.name ?? "Lake"}: fitted to ${(surface.depthFitScale! * 100).toFixed(1)}% of requested depth; ${surface.appliedDepthExaggeration!.toFixed(3)}x terrain depth scale.\n`).join("");
  const vertical = `Vertical exaggeration: ${ir.verticalExaggeration.toFixed(1)}x${scale}\n`;
  const linework = lineworkSummary(config.lineStyle, "Engraved line widths", [], [`labels and guides ${format(config.lineStyle.annotationMm)} mm`]) + aviationSummary(ir, config);
  const seams = ir.splitPlan ? (() => {
    const pieces = ir.layers.reduce((total, layer) => total + layer.pieces.length, 0);
    const perLayer = `${ir.splitPlan!.columns} x ${ir.splitPlan!.rows}`;
    const seamOffset = Math.max(ir.splitPlan!.seamOffsetXMm, ir.splitPlan!.seamOffsetYMm);
    const ids = config.showAssemblyLabels
      ? `Each piece carries its assembly id (layer number and grid cell, e.g. L03-B2) engraved in green as a separate ASSEMBLY operation. Those marks sit where the next layer covers them, so they disappear once the stack is glued; a piece with no covered room carries no id, and the top layer carries none at all - use the panel filename for those.\n`
      : "Assembly ids are turned off. The panel filename is the only piece identifier.\n";
    return `This model is larger than the ${shownLength(config.workAreaWidthMm || config.widthMm)} x ${shownLength(config.workAreaHeightMm || config.heightMm)} work area, so each layer is cut as ${perLayer} pieces (${pieces} in total) that butt together. Every panel SVG holds one work-area cell and fits the machine; a piece kept whole across a seam ships on its own sheet (cell name with a numeric suffix) when it would not fit beside its cell.\n\n${seamOffset > 0 ? `Seams shift ${shownLength(seamOffset)} on alternating layers, so a seam in one layer sits over solid material in the layers above and below - glue the stack in layer order and the joints overlap instead of stacking into one crack.` : "Seams line up on every layer (seam offset 0), so the joints stack straight through the model - back them with a glue strip or a sub-base."} Seam edges get the same outward kerf compensation as every other cut edge, so pieces butt together at their nominal size.\n\n${config.seamTabs ? "Wherever a seam runs under the next layer up, it is cut as interlocking jigsaw tabs. Each piece only fits its true neighbour and locks into line with it; press the tabs home before gluing. Where a seam stays visible - on the top layer or an exposed slope - it is left straight.\n\n" : ""}${ids}\n`;
  })() : "";
  const paintCount = panelFiles.reduce((total, { paintFiles }) => total + paintFiles.length, 0);
  const paint = config.paintTemplates.length ? (paintCount
    ? `Paint templates: ${paintCount} panel${paintCount === 1 ? " has" : "s have"} a registered -paint-<kind>.svg companion (${config.paintTemplates.join(", ")}). Cut each one from paper or stencil film with kerf compensation turned off: each path is the piece at nominal size with the ${config.paintTemplates.join("/")} that stays visible after assembly cut away, extended ${shownLength(PAINT_BLEED_MM)} under the layer above so a slightly misplaced stencil leaves no bare edge at the foot of the step. Where the ${config.paintTemplates.join("/")} reaches the piece edge the stencil simply stops short of that edge, so register it on the edges and key tabs it keeps. Lay the stencil flush to the cut piece, spray, and remove it before gluing; the bleed lands on covered glue land, so wipe or lightly sand a thick paint film there. Every template path is a red CUT path. A panel with no visible ${config.paintTemplates.join("/")} has no template, and a piece painted edge to edge needs none, so it leaves no paper on the template.\n\n`
    : `Paint templates are enabled, but no panel has visible ${config.paintTemplates.join("/")}, so none were written.\n\n`) : "";
  const nesting = ir.fabricationNests.length ? `Material nesting reduced ${ir.layers.length} layer panels to ${panels.length} fabrication panels. Smaller layers share cut lines inside lower layers while preserving at least ${shownLength(config.glueMarginMm)} of covered glue land. Keep every loose cutout: nested pieces belong to the layer IDs listed in each panel filename and SVG data-layers attribute.\n\n` : config.optimizeMaterialUse ? (ir.splitPlan
    ? `No safe material nests fit the requested ${shownLength(config.glueMarginMm)} glue margin. A nested piece has to sit wholly inside one donor piece, and a work-area seam usually cuts through that room, so splitting a model normally costs its nesting.\n\n`
    : `No safe material nests fit the requested ${shownLength(config.glueMarginMm)} glue margin, so every layer remains on its own panel.\n\n`) : "Material-saving nesting is disabled.\n\n";
  const water = acrylic ? acrylic.readme(shownLength) : "";
  const airspaceText = airspace ? airspace.readme(shownLength) : "";
  const readme = `${ir.projectName}\n\n${ir.layers.length} layers at ${shownLength(config.materialThicknessMm)} each\nFinished stack height: ${shownLength(ir.layers.length * config.materialThicknessMm)}\n${vertical}${fittedDepths}${linework}${nested ? `Stock sheets: ${panels.length}` : `Fabrication panels: ${panels.length}`}\n\nCUT ${CUT}\nSCORE ${SCORE}\nENGRAVE ${ENGRAVE}\n${(ir.splitPlan || nested) && config.showAssemblyLabels ? `ASSEMBLY ${ASSEMBLY}\n` : ""}\nEvery complete panel and the master SVG place engraved and scored paths in named ENGRAVE and SCORE groups, both using Atomm blue for line engraving, separate from red CUT paths. Each panel also has a registered -engrave.svg companion containing the same ENGRAVE paths only. Use either the complete panel SVG, or pair its engraving-only companion with a cut workflow; do not process both engraving copies in the same job.\n\n${alignment}${kerf}${seams}${nesting}${nested ? sheetNestingText(nested, shownLength) : ""}${paint}${water}${airspaceText}Import the master SVG into xTool Studio, or use the fabrication-panel SVGs. In xTool Studio, choose Score for blue linework and Cut for red outlines. Engrave fills closed shapes; use it only for intentionally filled markers, not alignment outlines, contours, or line labels. Marker clearances are gaps in the line geometry; there is no white engraving operation. Verify each color layer's processing type, dimensions, and material settings before fabrication. Terrain data is decorative and is not survey or engineering data.\n\n${EXPORT_CREDIT}\n`;
  const files: ExportFile[] = [
    ...panelFiles.flatMap(({ file, engravingFile, paintFiles }) => [file, engravingFile, ...paintFiles]),
    master,
    ...(acrylic ? [...acrylic.files, acrylic.master] : []),
    ...(airspace ? airspace.files : []),
    { filename: `${base}-assembly-guide.html`, blob: new Blob([assemblyGuideToHtml(ir, config, panelFiles.map(({ panel, file, paintTemplates }) => ({
      filename: file.filename,
      // A split sheet may hold only some of its nest family's layers.
      layerIndexes: panel.layerIndexes.filter((index) => !panel.included || panel.included.get(index)?.size),
      cellName: panel.cellName,
      included: panel.included,
      paintTemplates: paintTemplates.map((template) => ({ kind: template.kind, filename: template.file.filename })),
      ...(nested ? { map: sheetMap(ir, nested.sheets[panel.sheetIndex!]!) } : {}),
    })), options.guideFonts, acrylic?.guide, airspace?.guide)], { type: "text/html" }) },
    { filename: `${base}-project.json`, blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }) },
    { filename: "README.txt", blob: new Blob([readme], { type: "text/plain" }) },
    { filename: "ATTRIBUTION.txt", blob: new Blob([attribution], { type: "text/plain" }) },
  ];
  if (files.reduce((total, file) => total + file.blob.size, 0) > MAX_EXPORT_PACKAGE_BYTES) throw new Error("The fabrication package exceeds Atomm's 100 MB export limit.");
  return {
    schemaVersion: 1,
    master,
    files,
  };
}

export function buildEngravingPackage(generated: GeometryIRV1, config: ProjectConfigV1): FabricationPackageV1 {
  const ir = { ...generated, projectId: config.id, projectName: config.name };
  if (config.outputMode !== "engraving") throw new Error("Choose flat engraving before exporting engraving artwork.");
  const reason = exportBlockReason(ir, config);
  if (reason) throw new Error(reason);
  const base = safeName(config.name);
  const master: ExportFile = { filename: `${base}-engraving.svg`, blob: new Blob([engravingToSvg(ir, config)], { type: "image/svg+xml" }) };
  const attribution = attributionText(ir);
  const manifest = {
    schemaVersion: 1,
    project: config,
    result: {
      projectId: ir.projectId,
      generatedAt: ir.generatedAt,
      outputMode: "engraving",
      contourCount: config.engravingContourCount,
      indexInterval: config.engravingIndexInterval,
      minElevationM: ir.minElevationM,
      maxElevationM: ir.maxElevationM,
      bounds: ir.bounds,
      resolutionM: ir.resolutionM,
      datasetVersion: ir.datasetVersion,
      warnings: ir.warnings,
      vectorStatus: ir.vectorStatus,
      ...(ir.aviationStatus ? { aviationStatus: ir.aviationStatus } : {}),
      ...(ir.aviationCycle ? { aviationCycle: ir.aviationCycle } : {}),
      lakeDataStatus: ir.lakeDataStatus,
      imagerySources: ir.imagerySources,
      terrainSelection: ir.terrainSelection,
    },
    attribution: ir.attribution,
  };
  const unit = lengthUnit(config.units);
  const size = `${format(displayLength(config.widthMm, config.units))} × ${format(displayLength(config.heightMm, config.units))} ${unit}`;
  const details = [
    config.showRoads ? "roads" : "",
    config.showTrails ? "trails" : "",
    config.showWater ? `water outlines${config.waterFillPattern !== "none" ? ` with ${config.waterFillPattern} fill` : ""}` : "",
    config.showBoundaries ? "state/province boundaries" : "",
    config.showCoordinateGrid ? "latitude/longitude grid" : "",
    aviationRequested(config) ? "FAA aviation detail" : "",
  ].filter(Boolean);
  const linework = lineworkSummary(config.lineStyle, "Line widths",
    [`minor contours ${format(config.lineStyle.contourMm)} mm`, `index contours ${format(config.lineStyle.indexContourMm)} mm`],
    [`annotations ${format(config.lineStyle.annotationMm)} mm`, `border ${format(config.lineStyle.borderMm)} mm`]) + aviationSummary(ir, config);
  const readme = `${ir.projectName}\n\nFlat topographic engraving\nArtwork size: ${size}\nContour lines: ${config.engravingContourCount}\nIndex contour: every ${config.engravingIndexInterval} lines\nWater fill: ${config.showWater ? config.waterFillPattern : "none"}\n${linework}Map details: ${details.length ? details.join(", ") : "none"}\nBorder: ${config.showEngravingBorder ? "engraved" : "none"}\n\nThe SVG contains one blue ENGRAVE operation group and no CUT or SCORE paths. In xTool Studio, choose Score for blue linework. Engrave fills closed shapes; reserve it for intentionally filled markers. Marker clearances are gaps in the line geometry; there is no white engraving operation. Minor and index contours are separated into named subgroups so their line weights can be assigned independently. Verify physical dimensions, focus, power, speed, and material settings with a small test engraving before processing the final item. Terrain data is decorative and is not survey, navigation, or engineering data.\n\n${EXPORT_CREDIT}\n`;
  const files: ExportFile[] = [
    master,
    { filename: `${base}-project.json`, blob: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }) },
    { filename: "README.txt", blob: new Blob([readme], { type: "text/plain" }) },
    { filename: "ATTRIBUTION.txt", blob: new Blob([attribution], { type: "text/plain" }) },
  ];
  if (files.reduce((total, file) => total + file.blob.size, 0) > MAX_EXPORT_PACKAGE_BYTES) throw new Error("The engraving package exceeds Atomm's 100 MB export limit.");
  return { schemaVersion: 1, master, files };
}

export function buildProjectPackage(ir: GeometryIRV1, config: ProjectConfigV1, options: PackageOptions = {}): FabricationPackageV1 {
  return config.outputMode === "engraving" ? buildEngravingPackage(ir, config) : buildFabricationPackage(ir, config, options);
}
