import { execFileSync } from "node:child_process";
import { sha256Hex } from "../lib/hash.mjs";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { PNG } from "pngjs";
import { createServer } from "vite";

// Renders the top-down depth map for lake pages from the same terrain and
// lake-floor data the studio uses, fetched from the map API.
//
//   node scripts/dev/render-lake-previews.mjs --sample | --slugs a,b | --all
//     [--out .topostack/lake-previews] [--api https://topostack.app] [--concurrency 1]
//
// Writes <slug>.webp and manifest.json to --out, plus index.html to review them.
// Lakes whose inputs match the manifest are skipped, so an interrupted run
// resumes. Needs cwebp (brew install webp). Nothing is uploaded.
const RENDERER_VERSION = 5;
const SAMPLE = [
  "crater-lake-oregon", "lake-tahoe-california-nevada", "mono-lake-california", "lake-superior-great-lakes-usa-canada",
  "leech-main-basin-cass-county-minnesota", "mille-lacs-mille-lacs-county-minnesota", "minnetonka-hennepin-county-minnesota", "pelican-crow-wing-county-minnesota",
  "mjosa-norway", "bodensee-switzerland", "lac-leman-switzerland", "lake-simcoe-ontario", "walker-lake-ontario", "siikajarvi-finland",
  "lake-okeechobee-palm-beach-county-florida", "lake-champlain-essex-county-new-york", "alan-henry-reservoir-texas",
  "sarkar-lake-prince-of-wales-hyder-census-area-alaska", "lake-pontchartrain-st-tammany-parish-louisiana", "lake-washington-king-county-washington",
];

const { values: args } = parseArgs({ options: {
  out: { type: "string" }, concurrency: { type: "string" }, api: { type: "string" },
  slugs: { type: "string" }, all: { type: "boolean" }, sample: { type: "boolean" },
} });
const out = resolve(args.out ?? ".topostack/lake-previews");
// One at a time by default: the map API rate-limits uncached terrain per client, and this shares its limits with visitors.
const concurrency = Math.max(1, Number(args.concurrency ?? 1));
process.env.VITE_MAP_API_URL = args.api ?? process.env.VITE_MAP_API_URL ?? "https://topostack.app";
try { execFileSync("cwebp", ["-version"], { stdio: "ignore" }); } catch { throw new Error("cwebp is required (brew install webp)."); }

const root = fileURLToPath(new URL("../../apps/generator/", import.meta.url));
// SvelteKit takes its project root from the working directory, not Vite's `root`.
process.chdir(root);
const vite = await createServer({ root, server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "warn" });
try {
  const { LAKE_PLACES } = await vite.ssrLoadModule("/src/lib/site/lake-pages.server.ts");
  const { preparePreview } = await vite.ssrLoadModule("/src/lib/site/lake-preview/prepare.ts");
  const { renderPreview } = await vite.ssrLoadModule("/src/lib/site/lake-preview/render.ts");
  const directory = JSON.parse(await readFile(join(root, "static/data/lake-depth-directory.json"), "utf8"));
  const lakes = new Map(directory.lakes.map((lake) => [lake.id, lake]));
  const surveyIds = new Set(directory.sources.map((source) => source.id));
  const bySlug = new Map([...LAKE_PLACES.values()].map((place) => [place.path.slice("/lake/".length), place]));
  const slugs = args.all ? [...bySlug.keys()] : args.sample ? SAMPLE : (args.slugs ?? "").split(",").filter(Boolean);
  if (!slugs.length) throw new Error("Pass --sample, --slugs a,b or --all.");
  const unknown = slugs.filter((slug) => !bySlug.has(slug));
  if (unknown.length) throw new Error(`No lake page for: ${unknown.join(", ")}`);

  await mkdir(out, { recursive: true });
  const manifestPath = join(out, "manifest.json");
  const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, "utf8")) : { rendererVersion: RENDERER_VERSION, api: process.env.VITE_MAP_API_URL, lakes: {} };
  const inputHash = (lake) => sha256Hex(JSON.stringify([RENDERER_VERSION, process.env.VITE_MAP_API_URL, directory.updated, lake.id, lake.bounds])).slice(0, 16);

  const queue = slugs.filter((slug) => {
    const entry = manifest.lakes[slug];
    return !(entry && entry.inputHash === inputHash(lakes.get(bySlug.get(slug).id)) && existsSync(join(out, `${slug}.webp`)));
  });
  console.log(`${slugs.length - queue.length} up to date, ${queue.length} to render with concurrency ${concurrency}.`);
  const failures = [];
  let done = 0;
  const started = Date.now();

  async function renderOne(slug) {
    const place = bySlug.get(slug);
    const lake = lakes.get(place.id);
    const t0 = Date.now();
    // Map API reads can fail transiently. Terrain refusals are rate limiting: the
    // Worker refuses a client for 60 s after it passes 240 uncached tiles a
    // minute, so wait that out rather than burning the remaining attempts.
    let prepared;
    for (let attempt = 1; !prepared; attempt++) {
      try { prepared = await preparePreview({ name: place.name, sourceId: lake.sourceId, surveyId: lake.surveyId, bounds: lake.bounds }); }
      catch (error) {
        if (attempt >= 4) throw error;
        const limited = error instanceof Error && /terrain unavailable/.test(error.message);
        await new Promise((wait) => setTimeout(wait, limited ? 65_000 : attempt * 5000));
      }
    }
    const t1 = Date.now();
    const image = renderPreview(prepared.input);
    const png = join(out, `${slug}.png`);
    await writeFile(png, PNG.sync.write({ width: image.width, height: image.height, data: Buffer.from(image.rgba.buffer, image.rgba.byteOffset, image.rgba.byteLength) }));
    const webp = join(out, `${slug}.webp`);
    execFileSync("cwebp", ["-quiet", "-q", "82", "-m", "6", png, "-o", webp]);
    await rm(png);
    const { size } = await stat(webp);
    manifest.lakes[slug] = {
      name: place.name, place: place.place, width: image.width, height: image.height, bytes: size,
      maxDepthM: Math.round(image.maxDepthM * 10) / 10, contourIntervalM: image.contourIntervalM, surveyedShare: Math.round(image.surveyedShare * 1000) / 1000,
      surveys: prepared.datasetVersion.split("+").filter((id) => surveyIds.has(id)), bathymetryStatus: prepared.bathymetryStatus, datasetVersion: prepared.datasetVersion, bounds: prepared.bounds,
      grid: [prepared.input.width, prepared.input.height], inputHash: inputHash(lake), renderedAt: new Date().toISOString(),
      timingMs: { data: t1 - t0, render: Date.now() - t1 },
    };
    done++;
    console.log(`[${done}/${queue.length}] ${slug}: ${image.width}×${image.height}, ${(size / 1024).toFixed(0)} KB, max ${image.maxDepthM.toFixed(1)} m, surveyed ${(image.surveyedShare * 100).toFixed(0)}%, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  const pending = [...queue];
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (let slug = pending.shift(); slug; slug = pending.shift()) {
      try { await renderOne(slug); } catch (error) {
        failures.push(slug);
        console.error(`${slug}: ${error instanceof Error ? error.message : error}`);
        // Never leave an older render standing in for a lake that now fails.
        delete manifest.lakes[slug];
        await rm(join(out, `${slug}.webp`), { force: true });
      }
      // Keep the manifest current so an interrupted run resumes where it stopped.
      await writeFile(manifestPath, JSON.stringify(manifest, null, 1) + "\n");
    }
  }));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 1) + "\n");

  const cards = Object.entries(manifest.lakes).sort(([a], [b]) => a.localeCompare(b)).map(([slug, entry]) => `<figure><img src="${slug}.webp" width="${entry.width}" height="${entry.height}" loading="lazy" alt=""><figcaption><strong>${entry.name}</strong>, ${entry.place} · max ${entry.maxDepthM} m · contours every ${entry.contourIntervalM} m · surveyed ${Math.round(entry.surveyedShare * 100)}% · ${(entry.bytes / 1024).toFixed(0)} KB</figcaption></figure>`).join("\n");
  await writeFile(join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Lake previews</title><style>body{font:14px system-ui;margin:24px;background:#f4f1ea}figure{display:inline-block;width:480px;margin:0 16px 24px 0;vertical-align:top}img{width:100%;height:auto;border:1px solid #ccc}</style>\n${cards}\n`);
  const seconds = (Date.now() - started) / 1000;
  console.log(`Rendered ${done} in ${seconds.toFixed(0)} s (${done ? (seconds / done).toFixed(1) : "–"} s each); ${failures.length} failed${failures.length ? `: ${failures.join(", ")}` : ""}. Review ${join(out, "index.html")}`);
  if (failures.length) process.exitCode = 1;
} finally {
  await vite.close();
}
