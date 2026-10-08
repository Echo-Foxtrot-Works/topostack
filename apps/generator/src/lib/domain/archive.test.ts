import { afterEach, describe, expect, it, vi } from "vitest";
import { clearArchiveCache, createArchive } from "$lib/domain/archive";
import { NETWORK_TIMEOUT_MS } from "$lib/domain/network";

function archiveBytes(directory = false): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(132);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("PMTiles")); bytes[7] = 3;
  view.setUint32(8, 127, true); view.setUint32(16, 5, true);
  view.setUint32(40, 132, true); view.setUint32(56, 137, true);
  bytes[97] = 1; bytes[98] = 1; bytes[99] = 1;
  bytes.set([1, 0, directory ? 0 : 1, directory ? 5 : 3, 1], 127);
  return bytes;
}

function response(bytes = archiveBytes()): Response {
  return new Response(bytes, { status: 206, headers: { etag: '"fixture"' } });
}

function stalled(signal: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => {
    signal.throwIfAborted();
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); clearArchiveCache(); });

describe("archive request lifecycle", () => {
  it("recovers on the next generation after a transient header failure", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockImplementation(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    await expect(createArchive("https://example.test/map.pmtiles").getHeader()).rejects.toThrow("503");
    await expect(createArchive("https://example.test/map.pmtiles").getHeader()).resolves.toMatchObject({ specVersion: 3 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reuses one reader per URL across operations", async () => {
    const fetchMock = vi.fn(async () => response());
    vi.stubGlobal("fetch", fetchMock);
    await expect(createArchive("https://example.test/map.pmtiles").getHeader()).resolves.toMatchObject({ etag: '"fixture"' });
    const second = createArchive("https://example.test/map.pmtiles");
    await second.getHeader();
    await second.getZxy(0, 0, 0);
    // One header read, then only the tile body.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await createArchive("https://example.test/other.pmtiles").getHeader();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("keeps a shared header request alive when one operation is cancelled", async () => {
    let release: (() => void) | undefined;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => { release = () => resolve(response()); }));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    const cancelled = createArchive("https://example.test/map.pmtiles", controller.signal).getHeader();
    const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
    const kept = createArchive("https://example.test/map.pmtiles").getHeader();
    controller.abort();
    await rejected;
    await vi.waitFor(() => expect(release).toBeDefined());
    release!();
    await expect(kept).resolves.toMatchObject({ specVersion: 3 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("requires a strong archive validator for generation consistency", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(archiveBytes(), { status: 206 })));
    await expect(createArchive("https://example.test/map.pmtiles").getHeader()).rejects.toThrow("strong ETag");
  });

  it("rejects archive replacement within an operation but permits a fresh generation", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(response())
      .mockImplementation(async () => new Response(archiveBytes(), { status: 206, headers: { etag: '"replacement"' } })));
    const archive = createArchive("https://example.test/map.pmtiles");
    await archive.getHeader();
    // An independently completed lookup must not be combined with earlier data.
    await expect(archive.getZxy(0, 0, 0)).rejects.toThrow("Archive changed");
    await expect(createArchive("https://example.test/map.pmtiles").getHeader()).resolves.toMatchObject({ specVersion: 3 });
  });

  it("retries once on a fresh reader when a cached header predates a data release", async () => {
    let etag = '"fixture"';
    const fetchMock = vi.fn(async () => new Response(archiveBytes(), { status: 206, headers: { etag } }));
    vi.stubGlobal("fetch", fetchMock);
    await createArchive("https://example.test/map.pmtiles").getHeader();
    etag = '"release"';
    const archive = createArchive("https://example.test/map.pmtiles");
    await expect(archive.getHeader()).resolves.toMatchObject({ etag: '"fixture"' });
    await expect(archive.getZxy(0, 0, 0)).resolves.toBeDefined();
    // Stale tile read, fresh header, retried tile.
    expect(fetchMock).toHaveBeenCalledTimes(4);
    // Later operations reuse the refreshed reader.
    await createArchive("https://example.test/map.pmtiles").getZxy(0, 0, 0);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not retry a generation change after the operation returned tile data", async () => {
    let etag = '"fixture"';
    vi.stubGlobal("fetch", vi.fn(async () => new Response(archiveBytes(), { status: 206, headers: { etag } })));
    await createArchive("https://example.test/map.pmtiles").getHeader();
    const archive = createArchive("https://example.test/map.pmtiles");
    await archive.getZxy(0, 0, 0);
    etag = '"release"';
    clearArchiveCache();
    await expect(archive.getZxy(0, 0, 0)).rejects.toThrow("Archive changed");
  });

  it.each(["header", "directory", "tile"])("cancels during the %s request", async (phase) => {
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      if (phase !== "header" && new Headers(init.headers).get("range")?.startsWith("bytes=0-")) return response(archiveBytes(phase === "directory"));
      return stalled(init.signal!);
    });
    vi.stubGlobal("fetch", fetchMock);
    const pending = createArchive("https://example.test/map.pmtiles", controller.signal).getZxy(0, 0, 0);
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(phase === "header" ? 1 : 2));
    controller.abort();
    await rejected;
  });

  it("bounds the header request even without user cancellation", async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    vi.stubGlobal("fetch", vi.fn((_url: string, init: RequestInit) => stalled(init.signal!)));
    const pending = createArchive("https://example.test/map.pmtiles").getHeader();
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(timeout).toHaveBeenCalledWith(NETWORK_TIMEOUT_MS);
    deadline.abort(new DOMException("Timed out", "TimeoutError"));
    await rejected;
  });

  it("cancels a stalled response body as well as the initial response", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => new Response(new ReadableStream({
      start(stream) { init.signal!.addEventListener("abort", () => stream.error(init.signal!.reason), { once: true }); },
    }), { status: 206 })));
    const pending = createArchive("https://example.test/map.pmtiles", controller.signal).getHeader();
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await Promise.resolve();
    controller.abort();
    await rejected;
  });
});
