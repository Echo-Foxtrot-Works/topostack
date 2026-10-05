import { describe, expect, it } from "vitest";
import { buildFabricationPackage, DEFAULT_PROJECT, generateGeometry } from "../index.js";
import { assemblyGuideToHtml } from "./assembly-guide.js";
import { realSource } from "../test-support/sources.js";

async function guideFor(config = DEFAULT_PROJECT) {
  const ir = generateGeometry(config, realSource(config));
  const pkg = buildFabricationPackage(ir, config);
  const file = pkg.files.find((entry) => entry.filename.endsWith("-assembly-guide.html"))!;
  return { ir, pkg, file, html: await file.blob.text() };
}

describe("assembly guide booklet", () => {
  it("ships one illustrated step per layer, bottom up, with every layer outline defined once", async () => {
    const { ir, file, html } = await guideFor();
    expect(file.filename).toBe("crater-lake-assembly-guide.html");
    expect(file.blob.type).toBe("text/html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("@page{size:letter");
    const steps = [...html.matchAll(/<article class="step" id="step-(\d+)">/g)].map((match) => Number(match[1]));
    expect(steps).toEqual(ir.layers.map((_, index) => index + 1));
    for (const layer of ir.layers) expect(html.match(new RegExp(`<path id="g-${layer.id}"`, "g"))).toHaveLength(1);
    // Step k draws the k - 1 layers beneath plus the highlighted new one.
    const last = html.slice(html.indexOf(`id="step-${ir.layers.length}"`));
    expect(last.slice(0, last.indexOf("</figure>")).match(/<use /g)).toHaveLength(ir.layers.length);
    expect(last).toContain("<strong>Top layer.</strong>");
    // The routine every layer follows is written once, not repeated per step.
    expect(html.match(/Spread a thin layer of glue/g)).toHaveLength(1);
    expect(html).toContain("<h3>For every layer</h3>");
    expect(html).toContain("<strong>Base layer.</strong>");
  });

  it("names the sheet each layer is cut from and flags nested pieces", async () => {
    const { ir, pkg, html } = await guideFor();
    expect(ir.fabricationNests.length).toBeGreaterThan(0);
    const panels = pkg.files.filter((entry) => /-(?:layer-\d+|panel-\d+-layers-[\d-]+)\.svg$/.test(entry.filename));
    for (const panel of panels) expect(html).toContain(`<code>${panel.filename}</code>`);
    const nested = ir.layers[ir.fabricationNests[0]!.nestedLayerIndex]!;
    const step = html.slice(html.indexOf(`id="step-${nested.index + 1}"`));
    expect(step.slice(0, step.indexOf("</article>"))).toMatch(/<strong>Nested\.<\/strong> (?:This piece was|These pieces were) cut from inside layer \d+/);
    expect(html).toContain("Keep every cutout.");
  });

  it("labels split pieces by cell and lists every sheet with its cell", async () => {
    const config = { ...DEFAULT_PROJECT, workAreaWidthMm: 160, workAreaHeightMm: 120 };
    const { ir, html } = await guideFor(config);
    expect(ir.splitPlan).toBeTruthy();
    expect(html).toContain("green id like <code>L03-B2</code>");
    expect(html).toMatch(/class="piece-id">[A-Z]\d/);
    expect(html).toMatch(/· cell [A-Z]\d/);
    expect(html).toContain("jigsaw tabs");
  });

  it("leaves painting out when templates are enabled but none were written", async () => {
    const { pkg, html } = await guideFor({ ...DEFAULT_PROJECT, paintTemplates: ["water"] });
    expect(pkg.files.some((entry) => entry.filename.includes("-paint-"))).toBe(false);
    expect(html).not.toContain("Paint before you glue");
    expect(html).not.toContain("paint template");
    expect(html).toContain('<p class="label">Section 2</p>\n<h2>Build the stack</h2>');
  });

  it("embeds the fonts it is given and references nothing on the network", () => {
    const ir = generateGeometry(DEFAULT_PROJECT, realSource());
    const plain = assemblyGuideToHtml(ir, DEFAULT_PROJECT, []);
    expect(plain).not.toContain("@font-face");
    expect(plain).not.toMatch(/(?:href|src)="https?:|url\(https?:/);
    const html = assemblyGuideToHtml(ir, DEFAULT_PROJECT, [], [
      { family: "Jost", weight: 500, woff2Base64: "d09GMgABAAA=" },
      { family: 'Evil"</style><script>', weight: 400, woff2Base64: "AAAA)</style>" },
    ]);
    expect(html).toContain('@font-face{font-family:"Jost";src:url(data:font/woff2;base64,d09GMgABAAA=) format("woff2");font-weight:500');
    expect(html).toContain('font-family:"Evil/stylescript"');
    expect(html.match(/<\/style>/g)).toHaveLength(1);
    expect(html).not.toMatch(/(?:href|src)="https?:|url\(https?:/);
  });

  it("follows the project's units and escapes the project name", () => {
    const config = { ...DEFAULT_PROJECT, name: "Rock & <Roll>", units: "imperial" as const };
    const ir = { ...generateGeometry(config, realSource(config)), projectName: config.name };
    const html = assemblyGuideToHtml(ir, config, []);
    expect(html).toContain("<h1>Rock &amp; &lt;Roll&gt;</h1>");
    expect(html).not.toContain("<Roll>");
    expect(html).toMatch(/<dd>[\d.]+ × [\d.]+ × [\d.]+ in<\/dd>/);
    expect(html).toMatch(/[\d,]+ ft – [\d,]+ ft/);
  });
});
