import { escapeXml } from "./svg-primitives.js";
import { formatNumber as format } from "../primitives/format.js";
import type { AirspaceColumnIR, AirspaceLevelIR, AirspaceRodCutIR, AirspaceRodSettingsV1, AirspaceStackForm, AirspaceTint, Polygon2D } from "../types.js";

/** The airspace as the assembly guide refers to it: the files written and what each level holds. */
export interface GuideAirspace {
  form: AirspaceStackForm;
  thicknessMm: number;
  rod: AirspaceRodSettingsV1;
  cutList: AirspaceRodCutIR[];
  rodTotalMm: number;
  backingFilenames: string[];
  /** Acrylic stock per tint, the sum of the pieces' bounding boxes in mm². */
  stock: Partial<Record<AirspaceTint, number>>;
  cycle?: string;
  levels: Array<{ level: AirspaceLevelIR; files: string[] }>;
  columns: AirspaceColumnIR[];
}

/** The guide's helpers the airspace pages draw with, passed in so both share one scale and style. */
export interface GuideAirspaceContext {
  length: (valueMm: number) => string;
  diagram: (body: string, label: string) => string;
  polygonPath: (polygon: Polygon2D) => string;
  /** The model outline the maps are drawn on. */
  outlineId: string;
  sectionNumber: number;
  labelSizeMm: number;
}

/** Chart colours, as in the 3D preview: the sectional's blue and magenta, and a pale clear. */
const TINT_FILL: Record<AirspaceTint, string> = { clear: "#cfe3ea", blue: "#5b8fd6", magenta: "#c063a2" };
const TINT_WORDS: Record<AirspaceTint, string> = { clear: "clear", blue: "blue tinted", magenta: "magenta tinted" };
const FORM_WORDS: Record<AirspaceStackForm, string> = { plates: "plates", tiers: "tiers", volumes: "solid volumes" };

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const feet = (value: number) => `${value.toLocaleString("en-US")} ft`;

/** The cover fact for the airspace. */
export function airspaceFact(airspace: GuideAirspace): [string, string] {
  const pieces = airspace.levels.reduce((total, entry) => total + entry.level.pieces.length, 0);
  const segments = airspace.columns.reduce((total, column) => total + column.segments.length, 0);
  return ["Airspace", `${plural(pieces, "piece")} on ${plural(airspace.levels.length, "level")}${segments ? `, ${plural(segments, "rod")}` : ""}`];
}

/** Lines for "You will need". */
export function airspaceNeeds(airspace: GuideAirspace, length: (valueMm: number) => string): string {
  const stock = (Object.entries(airspace.stock) as Array<[AirspaceTint, number]>)
    .map(([tint, area]) => `${TINT_WORDS[tint]} (about ${format(Math.ceil(area / 10_000) / 100)} m²)`).join(", ");
  const segments = airspace.columns.reduce((total, column) => total + column.segments.length, 0);
  return [
    `<li>${length(airspace.thicknessMm)} cast acrylic for the airspace: ${stock}</li>`,
    segments ? `<li>${length(airspace.rod.sizeMm)} ${airspace.rod.shape} rod for ${plural(segments, "support")}, ${length(airspace.rodTotalMm)} in all plus a little for each saw cut; acrylic, brass, aluminium or hardwood dowel all work</li>` : "",
    airspace.backingFilenames.length ? `<li>The backing sheet (${escapeXml(airspace.backingFilenames.join(", "))}), cut from the same material as the stack</li>` : "",
    "<li>Clear, acrylic-safe glue for the airspace (not superglue: it leaves a white haze on acrylic)</li>",
  ].filter(Boolean).join("\n");
}

/** Every rod standing under a level's pieces, as a dot on a map of the level. */
function levelMap(entry: GuideAirspace["levels"][number], airspace: GuideAirspace, context: GuideAirspaceContext): string {
  const ids = new Set(entry.level.pieces.map((piece) => piece.id));
  const pieces = entry.level.pieces.map((piece) => `<path d="${piece.polygons.map(context.polygonPath).join("")}" fill="${TINT_FILL[piece.tint]}" fill-opacity="0.75" stroke="#20231d" stroke-width="${format(context.labelSizeMm * 0.08)}"/>`).join("");
  const rods = airspace.columns.flatMap((column) => column.segments.filter((segment) => ids.has(segment.headPieceId)).map((segment) => {
    const { x, y } = column.point;
    return `<circle cx="${format(x)}" cy="${format(y)}" r="${format(context.labelSizeMm * 0.35)}" fill="#20231d"/><text x="${format(x + context.labelSizeMm * 0.5)}" y="${format(y - context.labelSizeMm * 0.3)}" font-size="${format(context.labelSizeMm)}" fill="#20231d">${escapeXml(segment.rodId)}</text>`;
  })).join("");
  const names = entry.level.pieces.map((piece) => {
    const ring = piece.polygons[0]!.outer;
    const x = ring.reduce((sum, point) => sum + point.x, 0) / ring.length;
    const y = ring.reduce((sum, point) => sum + point.y, 0) / ring.length;
    return `<text x="${format(x)}" y="${format(y)}" font-size="${format(context.labelSizeMm * 1.2)}" font-weight="600" fill="#20231d" text-anchor="middle">${escapeXml(piece.id)}</text>`;
  }).join("");
  const label = `Level ${entry.level.index + 1} at ${feet(entry.level.altitudeFt)}: ${entry.level.pieces.map((piece) => piece.id).join(", ")}`;
  return `<figure>${context.diagram(`<use href="#${context.outlineId}" fill="#ece8df"/>${pieces}${rods}${names}`, label)}<figcaption>${escapeXml(label)}</figcaption></figure>`;
}

/** The airspace pages: what to cut, where every rod goes, and how to build it up. */
export function airspaceSection(airspace: GuideAirspace, context: GuideAirspaceContext): string {
  const { length } = context;
  const segments = airspace.columns.flatMap((column) => column.segments);
  const rodsUnder = (level: AirspaceLevelIR) => {
    const ids = new Set(level.pieces.map((piece) => piece.id));
    return segments.filter((segment) => ids.has(segment.headPieceId));
  };
  const levelRows = airspace.levels.map(({ level, files }) => {
    const rods = rodsUnder(level);
    const lengths = [...new Set(rods.map((segment) => segment.rodId))].map((id) => `${rods.filter((segment) => segment.rodId === id).length} × ${id}`).join(", ");
    const resting = level.pieces.filter((piece) => piece.resting).map((piece) => piece.id);
    return `<tr><td>${level.index + 1}</td><td>${feet(level.altitudeFt)}${level.mergedFt.length ? ` <span class="muted">(with ${level.mergedFt.map(feet).join(", ")})</span>` : ""}</td><td>${length(level.zMm)}</td><td>${level.pieces.map((piece) => escapeXml(piece.id)).join(", ")}</td><td>${lengths || (resting.length ? "glued on the level below" : "")}</td><td>${files.map((file) => `<code>${escapeXml(file)}</code>`).join("<br>")}</td></tr>`;
  }).join("");
  const cutRows = airspace.cutList.map((rod) => `<tr><td><strong>${escapeXml(rod.id)}</strong></td><td>${length(rod.lengthMm)}</td><td>${rod.count}</td></tr>`).join("");
  const steps = [
    "Finish the terrain stack first and let it cure.",
    ...(airspace.backingFilenames.length ? ["Glue the backing sheet under the bottom layer, edges flush. Some rods go through the bottom layer and stand on it."] : []),
    ...(segments.length ? [`Cut the rods to the cut list, square and clean, and mark each with its id. Sand a burr off each end so it sits flat.`] : []),
    "Build the airspace from the lowest level up. For each level, stand its rods where the map shows them: in their sockets in the terrain, or on the rod outlines engraved on the pieces below, with a dot of glue.",
    "Peel the underside film off the level's pieces, dry-fit them so every rod meets the outline engraved on the piece (seen through the acrylic), then glue each rod top with a small drop and let it set before the next level.",
    ...(airspace.form === "volumes" ? ["Stacked sheets of a volume are glued face to face on the sheet below with thin, even beads, so no rod is needed between them."] : []),
    "Peel the top films last.",
  ];
  return `<section class="page">
<p class="label">Section ${context.sectionNumber}</p>
<h2>Build the airspace</h2>
<p>The airspace is built as ${FORM_WORDS[airspace.form]} in ${length(airspace.thicknessMm)} acrylic, at true height over the terrain. Each level sits where its altitude would on the model's vertical scale. Pieces carry no engraved ids: use the maps below.</p>
<ol class="numbered">${steps.map((step) => `<li>${step}</li>`).join("")}</ol>
${cutRows ? `<h3>Rod cut list</h3>
<p class="muted">Lengths include the part that sits in a socket.</p>
<table><thead><tr><th>Rod</th><th>Length</th><th>Count</th></tr></thead><tbody>${cutRows}</tbody></table>` : ""}
<h3 style="margin-top:24px">Levels</h3>
<table><thead><tr><th>Level</th><th>Altitude</th><th>Height</th><th>Pieces</th><th>Rods under it</th><th>File</th></tr></thead><tbody>${levelRows}</tbody></table>
<div class="sheet-maps">${airspace.levels.map((entry) => levelMap(entry, airspace, context)).join("")}</div>
<p class="muted">Airspace from FAA data${airspace.cycle ? ` of the ${escapeXml(airspace.cycle)} cycle` : ""}. Not for navigation.</p>
</section>`;
}
