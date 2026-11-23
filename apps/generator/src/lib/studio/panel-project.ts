import { createXtoolId, svgPagesToLightBurn, svgToXtoolCanvas, type FabricationPackageV1 } from "@topostack/core";
import { strToU8, type AsyncZippable } from "fflate";
import type { PreparedDownload } from "./native-export";
import { zipBlob } from "./zip-blob";

type Canvas = NonNullable<ReturnType<typeof svgToXtoolCanvas>>;
const STUDIO_CANVAS_LIMIT = 100;
const DISPLAY_CHUNK = 500;

function titleFor(suffix: string): string {
  if (suffix === "engraving") return "Engraving";
  const [panel, paint] = suffix.split("-paint-");
  const title = panel!.replace(/-layers-([\d-]*\d)/, (_, ids: string) => ` (layers ${ids.split("-").join(", ")})`)
    .replaceAll("-", " ").replace(/^./, c => c.toUpperCase());
  return paint ? `Stencil · ${title} · ${paint.replaceAll("-", " ")}` : title;
}

async function studioProject(name: string, canvases: Canvas[]): Promise<Blob> {
  const entries: AsyncZippable = { ".format": strToU8("v2") };
  const put = (path: string, value: unknown) => { entries[path] = strToU8(JSON.stringify(value)); };
  const projectId = createXtoolId();
  put("meta/persistence-meta.json", { schemaVersion: "2.0.0", protocol: "xcs-workspace-v2" });
  put("project.json", {
    __v2__: true, version: "2.0.0", schemaMeta: { schemaVersion: "2.1.0", format: "directory" },
    projectId, projectTraceID: projectId, projectName: name, activeCanvasId: canvases[0]!.id,
    modules: { canvases: canvases.map(c => c.id), devices: [] },
    versionInfo: { source: "web", appVersion: "1.7.30" },
  });
  put("profiles.json", { profiles: {} });
  for (const { displays, ...canvas } of canvases) {
    const chunkIndexes: number[] = [];
    for (let offset = 0; offset < displays.length; offset += DISPLAY_CHUNK) {
      const chunkIndex = chunkIndexes.length;
      chunkIndexes.push(chunkIndex);
      put(`canvases/${canvas.id}/displays-${chunkIndex}.json`, { canvasId: canvas.id, chunkIndex, displays: displays.slice(offset, offset + DISPLAY_CHUNK) });
    }
    put(`canvases/${canvas.id}.json`, {
      ...canvas, hidden: false, extendInfo: { type: "2d", version: "2.16.2", minCanvasVersion: "0.0.0", displayProcessConfigMap: {} },
      chunkLayout: { displayCount: displays.length, chunkCount: chunkIndexes.length, chunkIndexes },
    });
  }
  return zipBlob(entries, "application/octet-stream");
}

export async function preparePanelProject(output: FabricationPackageV1, format: "xtool" | "lightburn-pages"): Promise<PreparedDownload> {
  const base = output.master.filename.replace(/-(?:master|engraving)\.svg$/, "");
  // The master and engraving companions repeat work present on the physical panels.
  const panels = output.files.filter(f => f.filename.endsWith(".svg") && !/-(?:master|engrave)\.svg$/.test(f.filename));
  const named = (filename: string) => titleFor(filename.slice(base.length + 1, -4));
  if (format === "lightburn-pages") {
    const pages = await Promise.all(panels.map(async f => ({ name: named(f.filename), svg: await f.blob.text() })));
    const xml = svgPagesToLightBurn(pages);
    if (xml) return { filename: `${base}-panels.lbrn2`, blob: new Blob([xml], { type: "application/xml" }), fileCount: 1 };
  } else {
    const projects: PreparedDownload[] = [];
    let batch: Canvas[] = [];
    const finish = async () => {
      projects.push({ filename: `${base}-panels-${String(projects.length + 1).padStart(2, "0")}.xs`, blob: await studioProject(base, batch), fileCount: 1 });
      batch = [];
    };
    for (const panel of panels) {
      const canvas = svgToXtoolCanvas(named(panel.filename), await panel.blob.text());
      if (canvas) batch.push(canvas);
      if (batch.length === STUDIO_CANVAS_LIMIT) await finish();
    }
    if (batch.length) await finish();
    if (projects.length === 1) return { ...projects[0]!, filename: `${base}.xs` };
    if (projects.length > 1) {
      const entries: AsyncZippable = {};
      for (const p of projects) entries[p.filename] = [new Uint8Array(await p.blob.arrayBuffer()), { level: 0 }];
      return { filename: `${base}-studio-projects.zip`, blob: await zipBlob(entries), fileCount: projects.length };
    }
  }
  throw new Error("There is no panel artwork to export.");
}
