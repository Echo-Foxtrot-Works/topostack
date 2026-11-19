import { buildProjectPackage, exportBlockReason, svgToLightBurn, type ExportFile, type FabricationPackageV1, type GeometryIRV1, type GuideFont, type ProjectConfigV1, type SheetNestPlanV1 } from "@topostack/core";
import jostUrl from "@loidolt/theme-styles/fonts/Jost-Medium.woff2?url";
import archivoUrl from "@loidolt/theme-styles/fonts/Archivo-Regular.woff2?url";
import { networkSignal } from "$lib/domain/network";

export { buildProjectPackage, exportBlockReason } from "@topostack/core";
export type ExportIntent = "download" | "openInStudio";

// The site's own faces, one weight per family as the theme ships them. The
// build already emits these files for the site stylesheet, so embedding them
// in the assembly guide costs a (usually cached) fetch, not bundle bytes.
const GUIDE_FONTS = [
  { family: "Jost", weight: 500, url: jostUrl },
  { family: "Archivo", weight: 400, url: archivoUrl },
];

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

let guideFonts: Promise<GuideFont[]> | undefined;

/** The site fonts as base64, loaded once. A font that fails to load is left out and the guide falls back to system fonts. */
export function loadGuideFonts(): Promise<GuideFont[]> {
  guideFonts ??= Promise.all(GUIDE_FONTS.map(async ({ family, weight, url }) => {
    try {
      const response = await fetch(url, { signal: networkSignal() });
      if (!response.ok) return [];
      return [{ family, weight, woff2Base64: toBase64(new Uint8Array(await response.arrayBuffer())) }];
    } catch {
      return [];
    }
  })).then((fonts) => fonts.flat());
  return guideFonts;
}

/**
 * The package with a LightBurn project (.lbrn2) beside every artwork SVG: each
 * panel, nested sheet, stencil and master. Engraving-only companions are left
 * out; the project's own Engrave layers can be run as a separate job instead.
 * `master` still points at the master SVG, which names the download.
 */
export async function withLightBurnProjects(output: FabricationPackageV1): Promise<FabricationPackageV1> {
  const sources = output.files.filter((file) => file.filename.endsWith(".svg") && !file.filename.endsWith("-engrave.svg"));
  const projects: ExportFile[] = [];
  for (const file of sources) {
    const xml = svgToLightBurn(await file.blob.text());
    if (!xml) continue; // Nothing to run, such as a stencil with no paint region.
    projects.push({ filename: file.filename.replace(/\.svg$/, ".lbrn2"), blob: new Blob([xml], { type: "application/xml" }) });
  }
  return { ...output, files: [...output.files, ...projects] };
}

/** Keep assembly ids in Atomm's standard line-engraving group, including its guide. */
export async function buildAtommPackage(geometry: GeometryIRV1, project: ProjectConfigV1, fonts: readonly GuideFont[] = [], sheetPlan?: SheetNestPlanV1, acrylicSheetPlan?: SheetNestPlanV1) {
  const output = buildProjectPackage(geometry, project, { guideFonts: fonts, sheetPlan, acrylicSheetPlan });
  const files = await Promise.all(output.files.map(async file => {
    if (!/\.(svg|html|txt)$/.test(file.filename)) return file;
    const original = await file.blob.text();
    const text = original.replace(/#00A651/gi, "#2366FF").replace(/engraved in green/g, "engraved in blue").replace(/green id/g, "blue id");
    return text === original ? file : { ...file, blob: new Blob([text], { type: file.blob.type }) };
  }));
  return { ...output, files, master: files.find(file => file.filename === output.master.filename)! };
}

/**
 * What Open in Studio leaves out. Studio opens one file, the wood master;
 * acrylic water inserts and acrylic airspace are another material and another
 * job, so they travel only in the download. Empty when nothing is left out.
 */
export function acrylicOutsideStudio(geometry: GeometryIRV1): string {
  const inserts = Boolean(geometry.waterInserts?.length);
  const airspace = Boolean(geometry.airspaceStack?.levels.length);
  if (!inserts && !airspace) return "";
  const what = inserts && airspace ? "water inserts and airspace are" : inserts ? "water inserts are" : "airspace is";
  return `The acrylic ${what} not in it: download the project files for their own SVGs.`;
}

export async function createAtommExport(geometry: GeometryIRV1, project: ProjectConfigV1, intent: ExportIntent, fonts: readonly GuideFont[] = [], sheetPlan?: SheetNestPlanV1, acrylicSheetPlan?: SheetNestPlanV1) {
  const reason = exportBlockReason(geometry, project);
  if (reason) throw new Error(reason);
  const output = await buildAtommPackage(geometry, project, fonts, sheetPlan, acrylicSheetPlan);
  return intent === "openInStudio" ? { filename: output.master.filename, blob: output.master.blob } : output.files;
}
