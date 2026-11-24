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

  it.each(["old-first", "refresh-first"])("keeps sibling tiles on one release when the %s read completes", async (order) => {
    const directory = [2, 1, 3, 1, 1, 1, 1, 1, 0]; // z1 tiles (0,0) and (1,0), one byte each
    const header = new Uint8Array(127 + directory.length);
    header.set(archiveBytes().subarray(0, 127));
    const view = new DataView(header.buffer);
    view.setUint32(16, directory.length, true);
    view.setUint32(56, header.length, true);
    header[100] = 1; header[101] = 1;
    header.set(directory, 127);
    const bytes = (body: Uint8Array<ArrayBuffer>, etag: string) => new Response(body, { status: 206, headers: { etag } });
    let headers = 0, tiles = 0;
    let finishOld: (() => void) | undefined;
    let finishRefresh: (() => void) | undefined;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (new Headers(init.headers).get("range")!.startsWith("bytes=0-")) {
        if (++headers === 1) return bytes(header, '"old"');
        await new Promise<void>((resolve) => { finishRefresh = resolve; });
        return bytes(header, '"new"');
      }
      if (++tiles === 1) {
        await new Promise<void>((resolve) => { finishOld = resolve; });
        return bytes(Uint8Array.of(1), '"old"');
      }
      return bytes(Uint8Array.of(2), '"new"');
    });
    const url = "https://example.test/roads.pmtiles";
    await createArchive(url).getHeader();
    const archive = createArchive(url);
    const left = archive.getZxy(1, 0, 0);
    await vi.waitFor(() => expect(finishOld).toBeDefined());
    if (order === "old-first") {
      finishOld!();
      expect(new Uint8Array((await left)!.data)).toEqual(Uint8Array.of(1));
      await expect(archive.getZxy(1, 1, 0)).rejects.toThrow("Archive changed");
    } else {
      const right = archive.getZxy(1, 1, 0);
      await vi.waitFor(() => expect(finishRefresh).toBeDefined());
      finishOld!();
      finishRefresh!();
      for (const tile of await Promise.all([left, right])) expect(new Uint8Array(tile!.data)).toEqual(Uint8Array.of(2));
    }
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
