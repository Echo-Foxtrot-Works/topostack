import { EtagMismatch, FetchSource, PMTiles, type Header, type RangeResponse } from "pmtiles";

import { networkSignal } from "$lib/domain/network";

export { networkSignal };

/** The archive operations generation uses. */
export type Archive = Pick<PMTiles, "getHeader" | "getMetadata" | "getZxy">;

interface CachedArchive {
  reader: PMTiles;
  metadata?: Promise<unknown>;
}

/**
 * One reader per archive URL, so the header, root and leaf directories, and
 * metadata are fetched once per archive generation instead of per operation.
 * A reader is evicted on any failure or ETag change: failed header promises
 * never poison retries, and a replaced archive starts a fresh reader.
 */
const readers = new Map<string, CachedArchive>();

/** Forget every cached archive reader. */
export function clearArchiveCache(): void { readers.clear(); }

class ArchiveChangedError extends Error {}
const changed = (cause?: unknown) => new ArchiveChangedError("Archive changed during generation. Try generating again.", cause === undefined ? undefined : { cause });

/** Header fields callers plan tile requests from; directory offsets may differ between archive generations. */
const PLANNING_HEADER_FIELDS = ["specVersion", "tileType", "tileCompression", "minZoom", "maxZoom", "minLon", "minLat", "maxLon", "maxLat", "centerZoom", "centerLon", "centerLat"] as const;
const samePlanningHeader = (left: Header, right: Header) => PLANNING_HEADER_FIELDS.every((field) => left[field] === right[field]);

function readerFor(url: string): CachedArchive {
  const existing = readers.get(url);
  if (existing) return existing;
  const evict = () => { if (readers.get(url) === entry) readers.delete(url); };

  class ArchiveSource extends FetchSource {
    private archiveEtag?: string;

    override async getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
      // Includes headers, directories, and response bodies. PMTiles does not
      // forward a signal to the shared header request, so it is bounded here.
      const bounded = networkSignal(signal);
      bounded.throwIfAborted();
      try {
        const response = await super.getBytes(offset, length, bounded, etag).catch((error: unknown) => {
          // Retrying a single tile could mix generations, and PMTiles starts a
          // detached header refresh on mismatch. End this operation instead.
          if (error instanceof EtagMismatch) throw changed(error);
          throw error;
        });
        if (!response.etag) throw new Error("Archive response is missing a strong ETag.");
        // PMTiles can re-read a pruned header or retry a lookup after an ETag
        // change. Everything this reader returned belongs to one archive
        // generation, so reject the reader instead of merging two.
        if (this.archiveEtag && response.etag !== this.archiveEtag) throw changed();
        this.archiveEtag ??= response.etag;
        return response;
      } catch (error) {
        // A caller's cancellation leaves the reader intact; anything else may
        // have left a rejected promise in the PMTiles cache.
        if (!signal?.aborted) evict();
        throw error;
      }
    }
  }

  const entry: CachedArchive = { reader: new PMTiles(new ArchiveSource(url)) };
  readers.set(url, entry);
  return entry;
}

/** Settle with `promise`, or reject as soon as `signal` aborts. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * An archive handle for one generation operation. It shares the URL's cached
 * reader, rejects as soon as `operationSignal` aborts, and fails if the
 * archive's generation changes while the operation runs.
 */
export function createArchive(url: string, operationSignal?: AbortSignal): Archive {
  let entry: CachedArchive | undefined;
  let operationHeader: Header | undefined;
  /** The operation started on a reader cached by an earlier one, whose header may predate a data release. */
  let reusedReader = false;
  /** Metadata or tiles were returned, so a later generation change can no longer be retried safely. */
  let delivered = false;
  let refresh: Promise<void> | undefined;
  const evict = () => { if (entry && readers.get(url) === entry) readers.delete(url); };

  const attempt = async <T>(current: CachedArchive, task: (entry: CachedArchive, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> => {
    const header = await current.reader.getHeader();
    if (operationHeader && header.etag !== operationHeader.etag) throw changed();
    operationHeader ??= header;
    return task(current, signal);
  };

  /**
   * A cached reader can hold the header of an archive that was since replaced.
   * Its first data request then fails with a generation change even though this
   * operation has read nothing stale but the header. Start over on a fresh
   * reader once, as long as the tile layout callers planned from is unchanged.
   */
  const refreshReader = async (stale: CachedArchive): Promise<void> => {
    if (readers.get(url) === stale) readers.delete(url);
    const fresh = readerFor(url);
    const header = await fresh.reader.getHeader();
    if (operationHeader && !samePlanningHeader(operationHeader, header)) throw changed();
    entry = fresh;
    operationHeader = header;
  };

  const run = async <T>(task: (entry: CachedArchive, signal?: AbortSignal) => Promise<T>, signal?: AbortSignal, returnsData = true): Promise<T> => {
    const signals = [operationSignal, signal].filter((item): item is AbortSignal => !!item);
    const combined = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    combined?.throwIfAborted();
    if (!entry) { reusedReader = readers.has(url); entry = readerFor(url); }
    const current = entry;
    const work = (async () => {
      try {
        const result = await attempt(current, task, combined);
        if (returnsData) delivered = true;
        return result;
      } catch (error) {
        if (!(error instanceof ArchiveChangedError) || combined?.aborted) throw error;
        if (current === entry) {
          if (!reusedReader || delivered) throw error;
          reusedReader = false;
          refresh = refreshReader(current);
        }
        if (!refresh) throw error;
        await refresh;
        const result = await attempt(entry!, task, combined);
        if (returnsData) delivered = true;
        return result;
      }
    })();
    // Evict on genuine failures even if this operation stopped waiting.
    work.catch(() => { if (!combined?.aborted) evict(); });
    return abortable(work, combined);
  };

  return {
    getHeader: () => run(async ({ reader }): Promise<Header> => reader.getHeader(), undefined, false),
    getMetadata: () => run(async (cached) => {
      const metadata = cached.metadata ??= cached.reader.getMetadata();
      return await metadata;
    }),
    getZxy: (z: number, x: number, y: number, signal?: AbortSignal) => run(async ({ reader }, combined) => reader.getZxy(z, x, y, combined), signal),
  };
}
