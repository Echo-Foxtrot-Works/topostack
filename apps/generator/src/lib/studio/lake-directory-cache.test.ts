import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_TIMEOUT_MS } from "$lib/domain/network";
import { loadLocationLakes, resetLocationLakes } from "$lib/studio/lake-directory-cache";

const directory = {
  schemaVersion: 1,
  updated: "2026-01-01",
  sources: [{ id: "src", name: "Survey", url: "https://example.test", license: "CC-BY", kind: "grid", region: "Test", group: "test" }],
  lakes: [{ id: "lake-1", name: "Test Lake", sourceId: "src", surveyId: "1", region: "Test", bounds: [-1, -1, 1, 1] }],
};

describe("location lake directory cache", () => {
  afterEach(() => { resetLocationLakes(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("fetches and indexes the directory once for repeated dialog opens", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(directory)));
    vi.stubGlobal("fetch", fetchMock);
    const first = await loadLocationLakes();
    const second = await loadLocationLakes();
    expect(first.map((lake) => lake.id)).toEqual(["lake-1"]);
    expect(second).toBe(first);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forgets a failed load so retry fetches again", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...directory, schemaVersion: 2 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(directory)));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadLocationLakes()).rejects.toThrow("Lake directory unavailable");
    await expect(loadLocationLakes()).rejects.toThrow("Invalid lake directory");
    await expect(loadLocationLakes()).resolves.toHaveLength(1);
    await loadLocationLakes();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("times out a stalled directory request and retries on the next open", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(deadline.signal);
    const fetchMock = vi.fn()
      .mockImplementationOnce((_url: string, init: RequestInit) => new Promise((_, reject) => {
        init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify(directory)));
    vi.stubGlobal("fetch", fetchMock);
    const stalled = loadLocationLakes();
    expect(timeout).toHaveBeenCalledWith(NETWORK_TIMEOUT_MS);
    deadline.abort(new DOMException("Timed out", "TimeoutError"));
    await expect(stalled).rejects.toMatchObject({ name: "TimeoutError" });
    await expect(loadLocationLakes()).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
