import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { sha256Hex } from "./hash.mjs";
import { writeJsonAtomic } from "./files.mjs";

export function previewInputHash(recipe, prepared) {
  const { input, ...source } = prepared;
  const { elevation, depth, water, surveyed, target, ...dimensions } = input;
  const hash = createHash("sha256").update(JSON.stringify([recipe, source, dimensions]));
  for (const grid of [elevation, depth, water, surveyed, target]) {
    hash.update(Buffer.from(grid.buffer, grid.byteOffset, grid.byteLength));
  }
  return hash.digest("hex");
}

export async function previewIsCurrent(entry, inputHash, imagePath) {
  if (!entry?.sha256 || entry.inputHash !== inputHash) return false;
  try { return sha256Hex(await readFile(imagePath)) === entry.sha256; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

export function previewCheckpoints(manifestPath, manifest) {
  let pending = Promise.resolve();
  return () => {
    pending = pending.then(() => writeJsonAtomic(manifestPath, manifest));
    return pending;
  };
}
