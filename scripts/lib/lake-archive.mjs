/**
 * Spawning side of the lake archive build: tool preflight and a tippecanoe
 * run whose output only replaces the previous archive once it completed.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { run } from "./process.mjs";
import { once } from "node:events";
import { rename, rm } from "node:fs/promises";

/**
 * Fails before any input is read when a build tool is missing. `--version`
 * exit codes differ between tippecanoe builds, so only a spawn failure (an
 * absent or non-executable binary) counts.
 */
export function assertExecutable(command, { install, args = ["--version"] } = {}) {
  const probe = spawnSync(command, args, { stdio: "ignore" });
  if (probe.error) {
    throw new Error(`${command} is required but could not be started (${probe.error.code ?? probe.error.message}).${install ? ` Install it with: ${install}` : ""}`);
  }
}

/**
 * Streams newline-delimited GeoJSON into tippecanoe and returns whatever
 * `emit` returns.
 *
 * The archive is built at `a unique sibling ending in .pmtiles` and renamed only after a clean
 * exit, so a mid-run failure - a full disk, a killed process, a malformed
 * feature - leaves the previous good archive in place instead of a truncated
 * one. Both the child and its stdin get an `error` listener: without them a
 * missing binary or a closed pipe is an unhandled event that kills the build
 * with no usable message.
 */
export async function writeTilesetArchive({ outputPath, args = [], command = "tippecanoe", spawnProcess = spawn, verify = (path) => run(process.env.PMTILES_BIN ?? "pmtiles", ["verify", path]), emit }) {
  const partPath = `${outputPath}.${randomUUID()}.part.pmtiles`;
  const writer = spawnProcess(command, ["--output", partPath, "--force", ...args], { stdio: ["pipe", "inherit", "inherit"] });
  let failure = null;
  const fail = (error) => { failure ??= error; };
  // A dead child never drains its stdin, so waiting for backpressure has to end
  // when the process does - otherwise a spawn failure or a crash mid-stream
  // hangs the build instead of reporting itself.
  const ended = new AbortController();
  writer.on("error", (error) => { fail(error); ended.abort(); });
  writer.stdin.on("error", fail);
  writer.once("close", () => ended.abort());
  // `error` records the failure above; even a failed spawn still emits `close`.
  // Keep this promise pending until the child and its stdio have finished.
  const closed = new Promise((resolve) => {
    writer.once("close", (code, signal) => resolve({ code, signal }));
  });
  try {
    const result = await emit(async (feature) => {
      if (failure) throw failure;
      if (writer.stdin.write(`${JSON.stringify(feature)}\n`)) return;
      try {
        await once(writer.stdin, "drain", { signal: ended.signal });
      } catch (error) {
        throw failure ?? (ended.signal.aborted ? new Error(`${command} exited before the archive was complete.`) : error);
      }
    });
    writer.stdin.end();
    const { code, signal } = await closed;
    if (failure) throw failure;
    if (code !== 0) throw new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`);
    await verify(partPath);
    await rename(partPath, outputPath);
    return result;
  } catch (error) {
    writer.stdin.destroy();
    writer.kill();
    // Sending a signal does not wait for exit. The writer can still create or
    // update its output until it closes, so deleting earlier can leave a part
    // file behind after this function has already rejected.
    await closed;
    await rm(partPath, { force: true });
    throw failure ?? error;
  }
}
