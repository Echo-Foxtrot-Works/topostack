import { zip, type AsyncZippable } from "fflate";
import type { FabricationPackageV1, ProjectConfigV1 } from "@topostack/core";
import type { UserChartBathymetryV1 } from "@topostack/data-contracts/chart-bathymetry";

export type DownloadOption = "all" | "master" | "panels" | "engravings" | "paint" | "assembly" | "project";

export interface PreparedDownload {
  blob: Blob;
  filename: string;
  fileCount: number;
}

function archiveFilename(masterFilename: string, suffix = "project-files"): string {
  const base = masterFilename
    .replace(/-(?:master|engraving)\.svg$/i, "")
    .replace(/\.[^.]+$/, "");
  return `${base || "topostack-project"}-${suffix}.zip`;
}

/** Build one browser download containing every fabrication file. */
export async function prepareProjectDownload(output: FabricationPackageV1): Promise<PreparedDownload> {
  const [only] = output.files;
  if (only && output.files.length === 1) {
    return { ...only, fileCount: 1 };
  }

  const entries: AsyncZippable = {};
  await Promise.all(output.files.map(async (file) => {
    entries[file.filename] = new Uint8Array(await file.blob.arrayBuffer());
  }));

  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => error ? reject(error) : resolve(data));
  });
  const archive = new Uint8Array(bytes.byteLength);
  archive.set(bytes);
  return {
    filename: archiveFilename(output.master.filename),
    blob: new Blob([archive.buffer], { type: "application/zip" }),
    fileCount: output.files.length,
  };
}

export function startBrowserDownload(download: PreparedDownload): void {
  const url = URL.createObjectURL(download.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/**
 * Settings can be saved before terrain has been generated, then imported later.
 * Traced depth charts travel with the file: they live only in the browser that
 * made them, so a project without them would open with plain survey depths.
 */
/**
 * The project stays indented for anyone reading the file. Charts are written
 * one per line: indented, a large chart's coordinates run to millions of lines
 * and several times the size, enough to fail the import limit.
 */
function projectFileText(project: ProjectConfigV1, charts: readonly UserChartBathymetryV1[]): string {
  if (!charts.length) return JSON.stringify({ schemaVersion: 1, project }, null, 2);
  const indentedProject = JSON.stringify(project, null, 2).replace(/\n/g, "\n  ");
  return `{\n  "schemaVersion": 1,\n  "project": ${indentedProject},\n  "charts": [\n${charts.map((chart) => `    ${JSON.stringify(chart)}`).join(",\n")}\n  ]\n}`;
}

export function prepareProjectSettings(project: ProjectConfigV1, charts: readonly UserChartBathymetryV1[] = []): PreparedDownload {
  const base = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topostack";
  return {
    filename: `${base}-project.json`,
    blob: new Blob([projectFileText(project, charts)], { type: "application/json" }),
    fileCount: 1,
  };
}

export async function prepareSelectedDownload(output: FabricationPackageV1, option: Exclude<DownloadOption, "project">): Promise<PreparedDownload> {
  if (option === "all") return prepareProjectDownload(output);
  if (option === "master") return { ...output.master, fileCount: 1 };
  const files = output.files.filter((file) => {
    if (option === "assembly") return file.filename.endsWith("-assembly-guide.html");
    // Match only the generated suffix so project names cannot affect selection.
    // A work-area split appends the seam cell ("-a1", or "-a1-2" for a piece
    // shipped on its own sheet).
    if (option === "engravings") return /-(?:layer-\d+|panel-\d+-layers-[\d-]+)(?:-[a-z]\d+(?:-\d+)?)?-engrave\.svg$/.test(file.filename);
    // A paint stencil is the panel filename plus its region kind.
    if (option === "paint") return /-(?:layer-\d+|panel-\d+-layers-[\d-]+)(?:-[a-z]\d+(?:-\d+)?)?-paint-[a-z-]+\.svg$/.test(file.filename);
    return /-(?:layer-\d+|panel-\d+-layers-[\d-]+)(?:-[a-z]\d+(?:-\d+)?)?\.svg$/.test(file.filename);
  });
  const [first] = files;
  if (!first) throw new Error(option === "paint" ? "No panel has visible water to paint, so there are no paint templates." : "This export is not available for the current output type.");
  if (option === "assembly") return { ...first, fileCount: 1 };
  // Keep fabrication instructions and source credits with panel bundles.
  files.push(...output.files.filter((file) => file.filename === "README.txt" || file.filename === "ATTRIBUTION.txt"));
  const download = await prepareProjectDownload({ ...output, files });
  const suffix = { panels: "cut-panels", engravings: "engraving-panels", paint: "paint-templates" }[option];
  return { ...download, filename: download.blob.type === "application/zip" ? archiveFilename(output.master.filename, suffix) : download.filename };
}
