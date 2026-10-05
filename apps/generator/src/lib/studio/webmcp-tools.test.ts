import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, projectFingerprint, type GeometryIRV1, type ProjectConfigV1 } from "@topostack/core";
import { webMcpTools, type WebMcpHost } from "$lib/studio/webmcp-tools";

function fakeHost(overrides: Partial<WebMcpHost> = {}) {
  let project: ProjectConfigV1 = DEFAULT_PROJECT;
  const geometry = { configFingerprint: projectFingerprint(DEFAULT_PROJECT), layers: Array.from({ length: 12 }, () => ({})) } as unknown as GeometryIRV1;
  const host: WebMcpHost = {
    project: () => project,
    geometry: () => geometry,
    generationState: () => "ready",
    status: () => "Terrain ready",
    exportBlockedBy: () => undefined,
    searchPlaces: vi.fn(async () => [{ id: "1", label: `Mount Hood${String.fromCharCode(0x202e)}, Oregon`, lat: 45.3736, lon: -121.6959, type: "amenity" }]),
    setLocation: vi.fn((location, name) => { project = { ...project, location, ...(name ? { name } : {}) }; }),
    applyPatch: vi.fn(async (patch) => { project = { ...project, ...patch }; }),
    generate: vi.fn(async () => undefined),
    undo: vi.fn(() => true),
    openExport: vi.fn(),
    editBlockedBy: () => undefined,
    ...overrides,
  };
  const tool = (name: string) => webMcpTools(host).find((entry) => entry.name === name)!;
  return { host, tool, project: () => project };
}

describe("studio WebMCP tools", () => {
  it("offers prefixed tools, read-only only where they change nothing", () => {
    const tools = webMcpTools(fakeHost().host);
    expect(tools.map(({ name }) => name)).toEqual(["topostack_get_design", "topostack_search_places", "topostack_set_area", "topostack_update_design", "topostack_generate_preview", "topostack_undo", "topostack_open_export"]);
    expect(tools.filter(({ annotations }) => annotations.readOnlyHint).map(({ name }) => name)).toEqual(["topostack_get_design", "topostack_search_places"]);
    for (const tool of tools) expect(tool.inputSchema.type).toBe("object");
  });

  it("describes the design, counting sheets only when the geometry is current", async () => {
    const { tool, host } = fakeHost();
    const result = await tool("topostack_get_design").execute({});
    expect(result.structuredContent).toMatchObject({ design: { output: "layered", materialThicknessMm: 3 }, sheets: 12, exportReady: true });
    expect(result.content[0]!.text).toContain("12 sheets generated");
    await host.applyPatch({ materialThicknessMm: 6 });
    expect((await tool("topostack_get_design").execute({})).structuredContent).not.toHaveProperty("sheets");
  });

  it("changes settings through the studio as one patch, and refuses what it may not touch", async () => {
    const { tool, host, project } = fakeHost();
    const result = await tool("topostack_update_design").execute({ output: "flat", contourCount: 20, details: { roads: false } });
    expect(result.isError).toBeUndefined();
    expect(host.applyPatch).toHaveBeenCalledWith({ outputMode: "engraving", engravingContourCount: 20, showRoads: false });
    expect(project()).toMatchObject({ outputMode: "engraving", engravingContourCount: 20 });
    expect((await tool("topostack_update_design").execute({ materialThicknessMm: 99 })).isError).toBe(true);
    expect((await tool("topostack_update_design").execute({ markers: [] })).isError).toBe(true);
    expect((await tool("topostack_update_design").execute({})).content[0]!.text).toBe("Nothing to change.");
    expect(host.applyPatch).toHaveBeenCalledOnce();
  });

  it("searches places with cleaned labels, then moves the design to one", async () => {
    const { tool, host, project } = fakeHost();
    const search = await tool("topostack_search_places").execute({ query: "Mount Hood" });
    const [place] = (search.structuredContent as { places: Array<{ label: string; area: { center: { lat: number; lon: number }; widthKm: number } }> }).places;
    expect(place!.label).toBe("Mount Hood, Oregon");
    await tool("topostack_set_area").execute({ area: place!.area, placeLabel: place!.label });
    expect(host.setLocation).toHaveBeenCalledOnce();
    expect(project()).toMatchObject({ name: "Mount Hood", location: { label: "Mount Hood, Oregon", lat: 45.3736 } });
    expect(project().location.bounds).toBeDefined();
    expect((await tool("topostack_set_area").execute({ area: { center: { lat: 99, lon: 0 }, widthKm: 5 } })).isError).toBe(true);
  });

  it("generates, reporting failure as an error", async () => {
    const failing = fakeHost({ generationState: () => "error", status: () => "Terrain service unavailable" });
    const result = await failing.tool("topostack_generate_preview").execute({});
    expect(failing.host.generate).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ isError: true, content: [{ text: "Generation failed: Terrain service unavailable" }] });
  });

  it("opens the export dialog without downloading, and undoes", async () => {
    const { tool, host } = fakeHost({ exportBlockedBy: () => "Generate before export" });
    const result = await tool("topostack_open_export").execute({});
    expect(host.openExport).toHaveBeenCalledOnce();
    expect(result.content[0]!.text).toContain("blocked: Generate before export");
    expect((await tool("topostack_undo").execute({})).content[0]!.text).toMatch(/^Undone\./);
    expect(host.undo).toHaveBeenCalledOnce();
    const empty = fakeHost({ undo: vi.fn(() => false) });
    expect((await empty.tool("topostack_undo").execute({})).content[0]!.text).toBe("Nothing to undo.");
  });

  it("refuses edits while the studio has a placement draft open", async () => {
    const { tool, host } = fakeHost({ editBlockedBy: () => "The studio is placing an item. Finish or cancel it there first." });
    for (const [name, input] of [["topostack_set_area", { area: { center: { lat: 45.37, lon: -121.7 }, widthKm: 10 } }], ["topostack_update_design", { widthMm: 250 }], ["topostack_undo", {}]] as const) {
      const result = await tool(name).execute(input);
      expect(result, name).toMatchObject({ isError: true, content: [{ text: "The studio is placing an item. Finish or cancel it there first." }] });
    }
    expect(host.setLocation).not.toHaveBeenCalled();
    expect(host.applyPatch).not.toHaveBeenCalled();
    expect(host.undo).not.toHaveBeenCalled();
  });
});
