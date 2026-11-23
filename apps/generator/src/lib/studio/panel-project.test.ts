import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { prepareSelectedDownload } from "./native-export";

const svg = '<svg width="60mm" height="40mm" viewBox="0 0 120 80"><g data-piece="hill" fill-rule="evenodd" transform="translate(8 6)"><path fill="#000000" d="M2 4L22 4L22 24L2 24ZM6 8L6 14L12 14L12 8Z"/></g></svg>';
const file = (suffix: string, content = svg) => ({ filename: `ridge-master-${suffix}.svg`, blob: new Blob([content]) });
const master = file("master");
const project = (files: ReturnType<typeof file>[]) => ({ schemaVersion: 1 as const, master, files });
const members = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));
const json = (files: Record<string, Uint8Array>, path: string) => JSON.parse(strFromU8(files[path]!));

describe("native panel downloads", () => {
  it("opens ordered, named Studio canvases with artwork in millimetres and separate stencil and acrylic stock", async () => {
    const panels = ["panel-01-layers-01-05", "panel-01-layers-01-05-engrave", "sheet-02", "sheet-02-paint-water", "acrylic-01", "acrylic-master", "airspace-blue-02", "airspace-backing"];
    const output = project([master, ...panels.map(s => file(s))]);
    const download = await prepareSelectedDownload(output, "xtool");
    expect(download.filename).toBe("ridge-master.xs");
    expect(download.blob.type).toBe("application/octet-stream");
    const files = await members(download.blob);
    const { modules, activeCanvasId } = json(files, "project.json");
    const ids: string[] = modules.canvases;
    expect(new Set(ids).size).toBe(6);
    expect(activeCanvasId).toBe(ids[0]);
    const canvases = ids.map(id => json(files, `canvases/${id}.json`));
    expect(canvases.map(c => c.title)).toEqual(["Panel 01 (layers 01, 05)", "Sheet 02", "Stencil · Sheet 02 · water", "Acrylic 01", "Airspace blue 02", "Airspace backing"]);
    const { displays } = json(files, `canvases/${ids[0]}/displays-0.json`);
    expect(displays).toHaveLength(1);
    expect(displays[0]).toMatchObject({
      x: 5, y: 5, width: 10, height: 10, isFill: true, isCompoundPath: true, fillRule: "evenodd",
      dPath: "M0 0L10 0L10 10L0 10ZM2 2L2 5L5 5L5 2Z",
    });
    expect(canvases[0].groupData[displays[0].groupTag].groupName).toBe("hill");
    const lightburn = await prepareSelectedDownload(output, "lightburn-pages");
    expect(lightburn.filename).toBe("ridge-master-panels.lbrn2");
    expect((await lightburn.blob.text()).match(/SubType="Page"/g)).toHaveLength(5);
  });

  it("downloads one Studio project at 100 canvases and splits the 101st into a second project", async () => {
    const panels = Array.from({ length: 101 }, (_, i) => file(`sheet-${i + 1}`));
    const atLimit = await prepareSelectedDownload(project(panels.slice(0, 100)), "xtool");
    expect(atLimit).toMatchObject({ filename: "ridge-master.xs", fileCount: 1 });
    const single = await members(atLimit.blob);
    expect(json(single, "project.json").modules.canvases).toHaveLength(100);

    const download = await prepareSelectedDownload(project(panels), "xtool");
    expect(download.fileCount).toBe(2);
    const archive = await members(download.blob);
    const names = Object.keys(archive).sort();
    expect(names).toEqual(["ridge-master-panels-01.xs", "ridge-master-panels-02.xs"]);
    const projects = names.map(name => unzipSync(archive[name]!));
    expect(projects.map(p => json(p, "project.json").modules.canvases.length)).toEqual([100, 1]);
    const last = projects[1]!;
    expect(json(last, `canvases/${json(last, "project.json").activeCanvasId}.json`).title).toBe("Sheet 101");
  });

  it("indexes every display chunk in a dense canvas", async () => {
    const path = '<path fill="none" stroke="#fe0002" d="M0 0L1 1"/>';
    const dense = file("sheet-01", `<svg>${path.repeat(501)}</svg>`);
    const download = await prepareSelectedDownload(project([dense]), "xtool");
    const entries = await members(download.blob);
    const id = json(entries, "project.json").activeCanvasId;
    const { chunkLayout } = json(entries, `canvases/${id}.json`);
    expect(chunkLayout.displayCount).toBe(501);
    expect(chunkLayout.chunkIndexes.map((i: number) => json(entries, `canvases/${id}/displays-${i}.json`).displays.length)).toEqual([500, 1]);
  });

  it("opens flat engravings directly and reports a package with no panel artwork", async () => {
    const flat = file("engraving");
    const download = await prepareSelectedDownload({ ...project([flat]), master: flat }, "xtool");
    const content = await members(download.blob);
    const id = json(content, "project.json").activeCanvasId;
    expect(json(content, `canvases/${id}.json`).title).toBe("Engraving");
    await expect(prepareSelectedDownload(project([master, file("layer-01", "<svg/>")]), "xtool")).rejects.toThrow("no panel artwork");
  });
});
