import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Turn the Atomm cover loop (a 6 s, 1920 × 1440 orbit of the Crater Lake stack
// rendered by the studio) into the README's animated preview. The loop is
// software-rendered; the README caption says so.
const ffmpeg = process.env.FFMPEG_PATH ?? "ffmpeg";
const img2webp = process.env.IMG2WEBP_PATH ?? "img2webp";
const source = fileURLToPath(new URL("../../atomm/assets/topostack-cover-loop-v8.mp4", import.meta.url));
const output = fileURLToPath(new URL("../../docs/images/topostack-stack.webp", import.meta.url));
const FPS = 12;
const WIDTH = 800;
const QUALITY = 50;
const MAX_BYTES = 3 * 1024 * 1024;
// The model stays inside this box for the whole orbit; the rest is backdrop.
const CROP = "1440:1040:240:300";

for (const [tool, hint] of [[ffmpeg, "brew install ffmpeg, or set FFMPEG_PATH"], [img2webp, "brew install webp, or set IMG2WEBP_PATH"]]) {
  try { execFileSync(tool, ["-version"], { stdio: "ignore" }); } catch { throw new Error(`${tool} is required (${hint}).`); }
}

const scratch = await mkdtemp(join(tmpdir(), "topostack-readme-media-"));
try {
  execFileSync(ffmpeg, ["-v", "error", "-y", "-i", source, "-vf", `crop=${CROP},fps=${FPS},scale=${WIDTH}:-2:flags=lanczos`, join(scratch, "frame-%03d.png")], { stdio: "inherit" });
  const frames = (await readdir(scratch)).filter((name) => name.endsWith(".png")).sort().map((name) => join(scratch, name));
  const delay = String(Math.round(1000 / FPS));
  execFileSync(img2webp, ["-loop", "0", "-lossy", "-q", String(QUALITY), "-m", "6", "-d", delay, ...frames, "-o", output], { stdio: "ignore" });
  const { size } = await stat(output);
  console.log(`${output}: ${frames.length} frames, ${(size / 1024 / 1024).toFixed(2)} MB`);
  if (size > MAX_BYTES) throw new Error(`Preview is ${size} bytes, above the ${MAX_BYTES}-byte limit; lower QUALITY, WIDTH or FPS.`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
