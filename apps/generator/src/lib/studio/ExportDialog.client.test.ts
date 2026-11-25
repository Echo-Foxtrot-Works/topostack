import { createRawSnippet, mount, tick, unmount } from "svelte";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DEFAULT_AIRSPACE_STACK, DEFAULT_PROJECT, type ProjectConfigV1 } from "@topostack/core";
import ExportDialog from "$lib/studio/ExportDialog.svelte";

describe("ExportDialog", () => {
  let component: ReturnType<typeof mount> | undefined;
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal ??= function () { this.open = true; };
    HTMLDialogElement.prototype.close ??= function () { this.open = false; this.dispatchEvent(new Event("close")); };
  });
  afterEach(async () => { if (component) await unmount(component); component = undefined; });

  async function render(project: Partial<ProjectConfigV1> = {}, props: { blockedReason?: string; panelCount?: number; nested?: boolean; acrylicCount?: number; acrylicNested?: boolean; airspaceCount?: number; sharing?: boolean; previewImageStatus?: string; layoutSteps?: boolean } = {}) {
    const onDownload = vi.fn();
    const onSavePreview = vi.fn();
    const onCopyLink = vi.fn();
    const target = document.createElement("div");
    component = mount(ExportDialog, { target, props: {
      open: true, project: { ...DEFAULT_PROJECT, ...project }, summary: "12 layers · 9 cut panels", panelCount: props.panelCount ?? 9, nested: props.nested, acrylicCount: props.acrylicCount, acrylicNested: props.acrylicNested, airspaceCount: props.airspaceCount,
      blockedReason: props.blockedReason, preparing: false, phase: "idle", title: "", detail: "",
      onDownload, onClose: () => undefined,
      onSavePreview: props.sharing ? onSavePreview : undefined,
      onCopyLink: props.sharing ? onCopyLink : undefined,
      previewImageStatus: props.previewImageStatus,
      panelsStep: props.layoutSteps ? createRawSnippet(() => ({ render: () => '<p class="test-panels">Panels and seams</p>' })) : undefined,
      sheetsStep: props.layoutSteps ? createRawSnippet(() => ({ render: () => '<p class="test-sheets">Sheet layout</p>' })) : undefined,
    } });
    await tick();
    const button = (name: string) => [...target.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.querySelector("strong")?.textContent === name);
    const rows = () => [...target.querySelectorAll(".export-more .export-row strong")].map((node) => node.textContent);
    const software = () => [...target.querySelectorAll(".export-software .export-row strong")].map((node) => node.textContent);
    const stepNames = () => [...target.querySelectorAll(".export-step-label")].map((node) => node.textContent);
    const stepTabNames = () => [...target.querySelectorAll(".export-step-tab .ldt-visually-hidden")].map((node) => node.textContent);
    const currentStep = () => target.querySelector('.export-step-tab[aria-current="step"] .export-step-label')?.textContent;
    const press = async (name: string) => { [...target.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === name)!.click(); await tick(); await tick(); };
    return { target, onDownload, onSavePreview, onCopyLink, button, rows, software, stepNames, stepTabNames, currentStep, press };
  }

  it("walks a layered export through panels, sheets, download and share, one step at a time", async () => {
    const { target, stepNames, currentStep, press, button } = await render({ outputMode: "stack" }, { layoutSteps: true });
    expect(stepNames()).toEqual(["Panels", "Sheets", "Download", "Share"]);
    expect(currentStep()).toBe("Panels");
    expect(target.querySelector(".test-panels")).not.toBeNull();
    expect(target.querySelector(".test-sheets, .export-hero, .export-support")).toBeNull();
    expect([...target.querySelectorAll("footer button")].map((node) => node.textContent?.trim())).toEqual(["Next: Sheets"]);
    await press("Next: Sheets");
    expect(currentStep()).toBe("Sheets");
    expect(target.querySelector(".test-sheets")).not.toBeNull();
    expect(target.querySelector(".test-panels")).toBeNull();
    expect(target.querySelector(".export-dialog-body")?.getAttribute("aria-label")).toBe("Step 2 of 4: Sheets");
    await press("Next: Download");
    expect(button("Complete project")).toBeDefined();
    await press("Back");
    expect(currentStep()).toBe("Sheets");
    // The step list jumps straight to any step.
    target.querySelectorAll<HTMLButtonElement>(".export-step-tab")[3]!.click();
    await tick(); await tick();
    expect(currentStep()).toBe("Share");
    expect(target.querySelector(".export-support")).not.toBeNull();
    expect(target.querySelectorAll(".export-step--done")).toHaveLength(3);
    expect([...target.querySelectorAll("footer button")].map((node) => node.textContent?.trim())).toEqual(["Back", "Done"]);
  });

  it("starts flat engravings at the download, with nothing to split or nest", async () => {
    const { stepNames, stepTabNames, currentStep } = await render({ outputMode: "engraving" }, { layoutSteps: true });
    expect(stepNames()).toEqual(["Download", "Share"]);
    // The spoken name stays whole where a narrow screen hides the visible label.
    expect(stepTabNames()).toEqual(["Step 1 of 2: Download", "Step 2 of 2: Share"]);
    expect(currentStep()).toBe("Download");
  });

  it("counts nested stock sheets instead of panels once the parts are nested", async () => {
    const { target } = await render({ outputMode: "stack" }, { panelCount: 2, nested: true });
    expect(target.querySelector(".export-hero")?.textContent).toContain("2 nested sheets");
  });

  it("adds the airspace panels to the count and offers them as their own download", async () => {
    const { target, button, onDownload } = await render({ outputMode: "stack", airspaceStack: DEFAULT_AIRSPACE_STACK }, { airspaceCount: 6 });
    expect(target.querySelector(".export-hero")?.textContent).toContain("9 panels + 6 airspace panels,");
    expect(button("Airspace")?.disabled).toBe(false);
    button("Airspace")!.click();
    expect(onDownload).toHaveBeenCalledWith("airspace");
    // Turned on, but nothing built here.
    const empty = await render({ outputMode: "stack", airspaceStack: DEFAULT_AIRSPACE_STACK }, { airspaceCount: 0 });
    expect(empty.button("Airspace")?.disabled).toBe(true);
    expect(empty.target.textContent).toContain("No airspace was built for this area.");
  });

  it("adds the acrylic insert panels or sheets to the complete project's count", async () => {
    const panels = await render({ outputMode: "stack" }, { acrylicCount: 1 });
    expect(panels.target.querySelector(".export-hero")?.textContent).toContain("9 panels + 1 acrylic panel,");
    const sheets = await render({ outputMode: "stack" }, { panelCount: 2, nested: true, acrylicCount: 2, acrylicNested: true });
    expect(sheets.target.querySelector(".export-hero")?.textContent).toContain("2 nested sheets + 2 acrylic sheets,");
  });

  it("leads layered projects with the complete project, then laser software projects, with specialist files behind a disclosure", async () => {
    const { target, onDownload, button, rows, software } = await render({ outputMode: "stack", paintTemplates: [] });
    expect(target.querySelector(".export-hero")?.textContent).toContain("Complete project");
    expect(target.querySelector(".export-hero")?.textContent).toContain("9 panels");
    expect(target.textContent).toContain("Crater Lake · 12 layers · 9 cut panels");
    expect(target.querySelector<HTMLDetailsElement>(".export-more")?.open).toBe(false);
    expect(rows()).toEqual(["Master SVG", "Cut panels", "Engraving panels", "Paint templates", "Acrylic inserts", "Airspace", "Assembly guide"]);
    expect(software()).toEqual(["xTool Studio project", "LightBurn project with pages", "Separate LightBurn files"]);
    expect(button("Paint templates")?.disabled).toBe(true);
    expect(button("Acrylic inserts")?.disabled).toBe(true);
    expect(button("Airspace")?.disabled).toBe(true);
    button("Complete project")!.click();
    button("Cut panels")!.click();
    button("xTool Studio project")!.click();
    button("LightBurn project with pages")!.click();
    button("Separate LightBurn files")!.click();
    expect(onDownload.mock.calls).toEqual([["all"], ["panels"], ["xtool"], ["lightburn-pages"], ["lightburn"]]);
  });

  it("offers only the engraving artwork for flat engravings", async () => {
    const { target, rows, software } = await render({ outputMode: "engraving" });
    expect(rows()).toEqual([]);
    expect(target.querySelector(".export-more")).toBeNull();
    expect(software()).toEqual(["Engraving SVG", "xTool Studio project", "LightBurn project"]);
    expect(target.querySelector(".export-hero")?.textContent).toContain("engraving SVG");
  });

  it("keeps project settings available when artwork export is blocked", async () => {
    const { target, onDownload, button } = await render({}, { blockedReason: "Generate real terrain first." });
    expect(target.querySelector("#export-blocked-reason")?.textContent).toContain("Generate real terrain first.");
    expect(button("Complete project")?.disabled).toBe(true);
    expect(button("Master SVG")?.disabled).toBe(true);
    button("Project settings")!.click();
    expect(onDownload).toHaveBeenCalledWith("project");
  });

  it("blocks stale preview images while allowing design links and announces sharing feedback inside the dialog", async () => {
    const { target, onSavePreview, onCopyLink, press } = await render({}, { blockedReason: "Generate real terrain first.", sharing: true, previewImageStatus: "Share link copied" });
    expect([...target.querySelectorAll('.export-guide a')].map((link) => [link.getAttribute("href")?.replace(/^.*\/guides\//, ""), link.getAttribute("target")])).toEqual([["lightburn", "_blank"], ["xtool-studio", "_blank"]]);
    await press("Next: Share");
    expect(target.querySelector("#export-blocked-reason")?.textContent).toContain("in the Download step");
    const buttons = [...target.querySelectorAll<HTMLButtonElement>("button")];
    expect(buttons.find((button) => button.textContent?.trim() === "Save preview image")!.disabled).toBe(true);
    buttons.find((button) => button.textContent?.trim() === "Copy design link")!.click();
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(onSavePreview).not.toHaveBeenCalled();
    expect(target.querySelector('.export-share > [role="status"]')?.textContent).toBe("Share link copied");
  });
});
