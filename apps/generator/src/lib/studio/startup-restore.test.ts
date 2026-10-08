import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PROJECT, type ProjectConfigV1 } from "@topostack/core";
import { UnreadableSavedProjectError } from "$lib/storage/storage";
import { restoreStartupProject, type StartupRestoreHost } from "$lib/studio/startup-restore";
import { shareLinkFor } from "$lib/studio/share-link";

function host(overrides: Partial<StartupRestoreHost> = {}) {
  let project: ProjectConfigV1 = DEFAULT_PROJECT;
  const statuses: string[] = [];
  const loadProject = vi.fn<() => Promise<ProjectConfigV1 | undefined>>(async () => undefined);
  const value = {
    loadProject,
    search: "",
    loadLakeLocation: () => import("$lib/site/lake-location"),
    consumeLakeLink: vi.fn(async () => undefined),
    hash: "",
    loadShareLink: () => import("$lib/studio/share-link"),
    consumeShareLink: vi.fn(async () => undefined),
    loadExample: vi.fn<(slug: string) => Promise<unknown>>(async () => undefined),
    consumeExampleLink: vi.fn(async () => undefined),
    consumeStarterLink: vi.fn(async () => undefined),
    onStarterOpened: vi.fn(() => undefined),
    isCancelled: () => false,
    currentProject: () => project,
    restoreSaved: vi.fn((saved: ProjectConfigV1) => { project = saved; }),
    openLinkedLake: vi.fn((next: ProjectConfigV1) => { project = next; }),
    generate: vi.fn(() => undefined),
    openSharedProject: vi.fn((next: ProjectConfigV1) => { project = next; }),
    openExample: vi.fn((next: ProjectConfigV1) => { project = next; }),
    setStatus: (message: string) => { statuses.push(message); },
    ...overrides,
  };
  return { value, loadProject, statuses, project: () => project };
}

describe("startup restore", () => {
  it("opens a starter over a saved design, waits for reviewed settings and consumes the link", async () => {
    const saved = { ...DEFAULT_PROJECT, name: "Saved design", workAreaWidthMm: 50 };
    const { value, loadProject, project } = host({ search: "?starter=engraving" });
    loadProject.mockResolvedValueOnce(saved);
    await restoreStartupProject(value);
    expect(value.openExample).toHaveBeenCalledWith(expect.objectContaining({ outputMode: "engraving", widthMm: 150, workAreaWidthMm: 0 }), saved);
    expect(value.onStarterOpened).toHaveBeenCalledWith("engraving");
    expect(value.consumeStarterLink).toHaveBeenCalledOnce();
    expect(value.generate).not.toHaveBeenCalled();
    expect(project().name).toContain("Flat contour engraving");
  });

  it("keeps the saved project for unknown starters and gives shared designs precedence", async () => {
    const saved = { ...DEFAULT_PROJECT, name: "Saved design" };
    const invalid = host({ search: "?starter=../missing" });
    invalid.loadProject.mockResolvedValueOnce(saved);
    await restoreStartupProject(invalid.value);
    expect(invalid.project()).toBe(saved);
    expect(invalid.value.onStarterOpened).not.toHaveBeenCalled();
    expect(invalid.value.consumeStarterLink).toHaveBeenCalledOnce();
    const shared = host({ search: "?starter=relief", hash: new URL(shareLinkFor(saved, "https://topostack.app/studio")).hash });
    await restoreStartupProject(shared.value);
    expect(shared.value.openSharedProject).toHaveBeenCalledOnce();
    expect(shared.value.onStarterOpened).not.toHaveBeenCalled();
  });
  it("opens a shared design on top of the saved project and clears the fragment", async () => {
    const shared = { ...DEFAULT_PROJECT, name: "Shared ridge", widthMm: 420 };
    const hash = `#${new URL(shareLinkFor(shared, "https://topostack.app/studio")).hash.slice(1)}`;
    const saved = { ...DEFAULT_PROJECT, materialThicknessMm: 5 };
    const { value, loadProject, statuses, project } = host({ hash, search: "?lake=Crater%20Lake&bounds=-122.2,42.9,-122.0,43.0" });
    loadProject.mockResolvedValueOnce(saved);
    await restoreStartupProject(value);
    expect(value.openSharedProject).toHaveBeenCalledWith(expect.objectContaining({ name: "Shared ridge", widthMm: 420 }), saved);
    expect(value.generate).not.toHaveBeenCalled();
    expect(project()).toMatchObject({ name: "Shared ridge", widthMm: 420 });
    expect(value.consumeShareLink).toHaveBeenCalledOnce();
    // A share link takes precedence over a directory link in the same URL.
    expect(value.openLinkedLake).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toContain("Shared design opened");
  });

  it("generates a shared design on arrival when its link asks to", async () => {
    const shared = { ...DEFAULT_PROJECT, name: "Agent ridge" };
    const hash = new URL(shareLinkFor(shared, "https://topostack.app/studio")).hash;
    const { value, statuses, project } = host({ hash, search: "?generate=1" });
    await restoreStartupProject(value);
    expect(project()).toMatchObject({ name: "Agent ridge" });
    // Generation starts after the design is open, so it builds the shared design.
    expect(value.generate).toHaveBeenCalledOnce();
    expect((value.openSharedProject as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan((value.generate as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!);
    expect(statuses.at(-1)).toContain("generating its terrain");
    const damaged = host({ hash: "#p=1.not-a-real-payload", search: "?generate=1" });
    await restoreStartupProject(damaged.value);
    expect(damaged.value.generate).not.toHaveBeenCalled();
  });

  it("keeps the saved project when a share link is damaged", async () => {
    const saved = { ...DEFAULT_PROJECT, materialThicknessMm: 5 };
    const { value, loadProject, statuses, project } = host({ hash: "#p=1.not-a-real-payload" });
    loadProject.mockResolvedValueOnce(saved);
    await restoreStartupProject(value);
    expect(value.openSharedProject).not.toHaveBeenCalled();
    expect(value.consumeShareLink).toHaveBeenCalledOnce();
    expect(project()).toBe(saved);
    expect(statuses.at(-1)).toMatch(/damaged.*saved project is unchanged/);
  });


  it("restores the saved project, then opens a directory lake on top of it", async () => {
    const { value, loadProject, statuses, project } = host({ search: "?lake=Crater%20Lake&bounds=-122.2,42.9,-122.0,43.0" });
    loadProject.mockResolvedValueOnce({ ...DEFAULT_PROJECT, materialThicknessMm: 5 });
    await expect(restoreStartupProject(value)).resolves.toEqual({ autosave: true });
    expect(value.restoreSaved).toHaveBeenCalledOnce();
    expect(value.consumeLakeLink).toHaveBeenCalledOnce();
    expect(project()).toMatchObject({ name: "Crater Lake", materialThicknessMm: 5, outputMode: "stack", showWaterDepth: true });
    expect(value.openLinkedLake).toHaveBeenCalledWith(project(), expect.objectContaining({ name: DEFAULT_PROJECT.name }));
    expect(statuses.at(-1)).toContain("Lake selected");
    // Generation starts only after the lake is open, so it builds the lake rather than the saved project.
    expect(value.generate).toHaveBeenCalledOnce();
    expect(vi.mocked(value.openLinkedLake).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(value.generate).mock.invocationCallOrder[0]!);
  });

  const exampleFile = (slug: string): unknown => JSON.parse(readFileSync(new URL(`../../../static/examples/${slug}.json`, import.meta.url), "utf8"));

  it("opens a published example on top of the saved project, clears the link and builds its terrain", async () => {
    const saved = { ...DEFAULT_PROJECT, materialThicknessMm: 5 };
    const { value, loadProject, statuses, project } = host({ search: "?example=mount-fuji" });
    loadProject.mockResolvedValueOnce(saved);
    vi.mocked(value.loadExample).mockImplementation(async (slug) => exampleFile(slug));
    await expect(restoreStartupProject(value)).resolves.toEqual({ autosave: true });
    expect(value.loadExample).toHaveBeenCalledWith("mount-fuji");
    expect(value.openExample).toHaveBeenCalledWith(expect.objectContaining({ id: "topostack-example-mount-fuji", cropShape: "circle", outputMode: "stack" }), saved);
    expect(project()).toMatchObject({ name: "Mount Fuji · TopoStack example" });
    expect(value.consumeExampleLink).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toContain("Example opened");
    expect(value.generate).toHaveBeenCalledOnce();
    expect(vi.mocked(value.openExample).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(value.generate).mock.invocationCallOrder[0]!);
  });

  it("opens the Crater Lake example as the default project without a download", async () => {
    const saved = { ...DEFAULT_PROJECT, name: "My ridge", materialThicknessMm: 5 };
    const { value, loadProject, project } = host({ search: "?example=crater-lake" });
    loadProject.mockResolvedValueOnce(saved);
    await restoreStartupProject(value);
    expect(value.loadExample).not.toHaveBeenCalled();
    expect(value.openExample).toHaveBeenCalledWith(DEFAULT_PROJECT, saved);
    expect(project()).toBe(DEFAULT_PROJECT);
    expect(value.generate).toHaveBeenCalledOnce();
  });

  it("never fetches an invalid example slug and keeps the saved project", async () => {
    for (const slug of ["../storage", "Mount-Fuji", "fuji.json", "", "a".repeat(81)]) {
      const saved = { ...DEFAULT_PROJECT, materialThicknessMm: 5 };
      const { value, loadProject, statuses, project } = host({ search: `?example=${encodeURIComponent(slug)}` });
      loadProject.mockResolvedValueOnce(saved);
      await restoreStartupProject(value);
      expect(value.loadExample, slug).not.toHaveBeenCalled();
      expect(value.openExample, slug).not.toHaveBeenCalled();
      expect(value.generate, slug).not.toHaveBeenCalled();
      expect(value.consumeExampleLink, slug).toHaveBeenCalledOnce();
      expect(project(), slug).toBe(saved);
      expect(statuses.at(-1), slug).toBe("Example not found · your project is unchanged");
    }
  });

  it("reports a missing example and keeps the saved project", async () => {
    const saved = { ...DEFAULT_PROJECT, materialThicknessMm: 5 };
    const { value, loadProject, statuses, project } = host({ search: "?example=atlantis" });
    loadProject.mockResolvedValueOnce(saved);
    await restoreStartupProject(value);
    expect(value.loadExample).toHaveBeenCalledWith("atlantis");
    expect(value.openExample).not.toHaveBeenCalled();
    expect(value.consumeExampleLink).toHaveBeenCalledOnce();
    expect(project()).toBe(saved);
    expect(statuses.at(-1)).toBe("Example not found · your project is unchanged");
  });

  it("reports an example that cannot be read or fetched", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const failure of [async () => ({ project: { schemaVersion: 2 } }), async () => { throw new TypeError("Failed to fetch"); }]) {
      const { value, statuses } = host({ search: "?example=mount-fuji" });
      vi.mocked(value.loadExample).mockImplementation(failure);
      await expect(restoreStartupProject(value)).resolves.toEqual({ autosave: true });
      expect(value.openExample).not.toHaveBeenCalled();
      expect(value.generate).not.toHaveBeenCalled();
      expect(value.consumeExampleLink).toHaveBeenCalledOnce();
      expect(statuses.at(-1)).toBe("Example could not be opened · your project is unchanged");
    }
    errors.mockRestore();
  });

  it("gives a share link precedence over an example, and an example precedence over a directory lake", async () => {
    const shared = { ...DEFAULT_PROJECT, name: "Shared ridge" };
    const hash = `#${new URL(shareLinkFor(shared, "https://topostack.app/studio")).hash.slice(1)}`;
    const withShare = host({ hash, search: "?example=mount-fuji" });
    await restoreStartupProject(withShare.value);
    expect(withShare.value.openSharedProject).toHaveBeenCalledOnce();
    expect(withShare.value.loadExample).not.toHaveBeenCalled();
    expect(withShare.value.consumeExampleLink).not.toHaveBeenCalled();

    const withLake = host({ search: "?example=mount-fuji&lake=Crater%20Lake&bounds=-122.2,42.9,-122.0,43.0" });
    vi.mocked(withLake.value.loadExample).mockImplementation(async (slug) => exampleFile(slug));
    await restoreStartupProject(withLake.value);
    expect(withLake.value.openExample).toHaveBeenCalledOnce();
    expect(withLake.value.openLinkedLake).not.toHaveBeenCalled();
    expect(withLake.value.generate).toHaveBeenCalledOnce();
  });

  it("keeps autosave running when an unreadable project was backed up, and still opens the link", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { value, loadProject, statuses } = host({ search: "?lake=Crater%20Lake&bounds=-122.2,42.9,-122.0,43.0" });
    loadProject.mockRejectedValueOnce(new UnreadableSavedProjectError("backup", new Error("bad")));
    await expect(restoreStartupProject(value)).resolves.toEqual({ autosave: true });
    expect(statuses[0]).toContain("backup copy was kept");
    expect(value.openLinkedLake).toHaveBeenCalledOnce();
    errors.mockRestore();
  });

  it("pauses autosave when an unreadable project could not be backed up", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { value, loadProject, statuses } = host();
    loadProject.mockRejectedValueOnce(new UnreadableSavedProjectError(undefined, new Error("quota")));
    await expect(restoreStartupProject(value)).resolves.toEqual({ autosave: false });
    expect(statuses[0]).toContain("autosave paused");
    errors.mockRestore();
  });

  it("reports other restore failures and stops once cancelled", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing = host();
    failing.loadProject.mockRejectedValueOnce(new Error("IndexedDB blocked"));
    await expect(restoreStartupProject(failing.value)).resolves.toEqual({ autosave: true });
    expect(failing.statuses).toEqual(["Saved project could not be restored · starting from the sample preview"]);
    const cancelled = host({ isCancelled: () => true });
    cancelled.loadProject.mockResolvedValueOnce(DEFAULT_PROJECT);
    await restoreStartupProject(cancelled.value);
    expect(cancelled.value.restoreSaved).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
