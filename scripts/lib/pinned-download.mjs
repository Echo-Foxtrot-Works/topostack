import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { sha256Hex } from "./hash.mjs";

const DOWNLOAD_TIMEOUT_MS = 120_000;

/**
 * The bytes at `url`, cached at `file` and always checked against the pinned
 * `sha256`. The download happens only when the cache is missing, and a fresh
 * download is verified before it is cached, so a changed upstream never
 * leaves a bad copy behind.
 */
export async function pinnedDownload({ url, sha256, file, label = url, headers = {} }) {
  let bytes = await readFile(file).catch((error) => {
    if (error.code === "ENOENT") return undefined;
    throw error;
  });
  const cached = Boolean(bytes);
  if (!bytes) {
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`${label}: download failed with ${response.status}.`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const actual = sha256Hex(bytes);
  if (actual !== sha256) throw new Error(`${label}: sha256 is ${actual}, pinned ${sha256}${cached ? ` (cached at ${file}; delete it to download again)` : ""}.`);
  if (!cached) {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
  return bytes;
}
