import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { boundsForProject, buildProjectPackage, createSyntheticSource, DEFAULT_PROJECT, generateGeometry, type ProjectConfigV1 } from "@topostack/core";
import { shareUrl } from "@topostack/data-contracts/share-link";
import { previewConfig } from "../apps/generator/src/mcp-app/preview";

async function readPreview(request: APIRequestContext, baseURL: string): Promise<string> {
  const preview = await (await request.get("/mcp-app/terrain-preview.html")).text();
  expect(preview).toContain("%TOPOSTACK_API_ORIGIN%");
  return preview.replaceAll("%TOPOSTACK_API_ORIGIN%", new URL(baseURL).origin);
}

// The page plays the chat host: it frames the built in-chat preview in a
// sandboxed iframe, answers the MCP Apps handshake and delivers a tool result.
async function showPreview(page: Page, html: string, toolResult: unknown) {
  // Inline script data must not contain "</script>", so "<" is escaped.
  const script = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  await page.setContent(`<!doctype html><html><body><iframe title="preview" sandbox="allow-scripts" style="width:640px;height:720px;border:0"></iframe>
    <script>(() => {
      window.received = [];
      window.opened = [];
      const frame = document.querySelector("iframe");
      const reply = (message) => frame.contentWindow.postMessage(message, "*");
      window.addEventListener("message", (event) => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data;
        window.received.push(message.method);
        if (message.method === "ui/initialize") reply({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "harness", version: "1" }, hostCapabilities: { openLinks: {} }, hostContext: { theme: "dark" } } });
        if (message.method === "ui/notifications/initialized") reply({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: ${script(toolResult)} });
        if (message.method === "ui/open-link") { window.opened.push(message.params.url); reply({ jsonrpc: "2.0", id: message.id, result: {} }); }
      });
      frame.srcdoc = ${script(html)};
    })();</script></body></html>`);
  return page.frameLocator("iframe");
}

function previewResult(project: ProjectConfigV1) {
  const { explodedPreview: _preview, ...design } = project;
  const studioUrl = shareUrl(design, "https://topostack.app/studio", "?generate=1");
  return { content: [{ type: "text", text: `${project.name} plan` }], structuredContent: { studioUrl, plan: { sheetCount: 12 }, attribution: { text: "Terrain: Mapzen Terrain Tiles · Map data © OpenStreetMap contributors" } } };
}

test("previews a planned model inside a sandboxed chat frame", async ({ page, request, baseURL }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  const result = previewResult({ ...DEFAULT_PROJECT, name: "Crater Lake" });
  const frame = await showPreview(page, await readPreview(request, baseURL!), result);
  await expect(frame.locator("h1")).toHaveText("Crater Lake");
  await expect(frame.locator("#figure svg path").first()).toBeAttached({ timeout: 30_000 });
  await expect(frame.locator("#stats")).toContainText("about 12 sheets");
  await expect(frame.locator("#stats")).toContainText(/Generated\s*\d+ sheets/);
  await expect(frame.locator("#status")).toContainText("added in TopoStack");
  await expect(frame.locator("footer")).toContainText("OpenStreetMap");
  await expect(frame.locator("html")).toHaveAttribute("data-theme", "dark");

  await frame.getByRole("button", { name: "Open in TopoStack" }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened)).toEqual([result.structuredContent.studioUrl]);
  expect(await page.evaluate(() => (window as unknown as { received: string[] }).received)).toContain("ui/notifications/size-changed");
  expect(pageErrors).toEqual([]);
});

test("flat chat previews match the packaged SVG with contours and borders on and off", async ({ page, request, baseURL }) => {
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  const html = await readPreview(request, baseURL!);
  for (const showEngravingContours of [true, false]) {
    for (const showEngravingBorder of [true, false]) {
      const project = { ...DEFAULT_PROJECT, name: "Flat Crater Lake", outputMode: "engraving" as const, showWater: false, showWaterDepth: false, showEngravingContours, showEngravingBorder };
      const config = previewConfig(project);
      // The browser build's deterministic terrain loader uses the same real-data fixture.
      const fixture = createSyntheticSource({ ...config, location: { ...config.location, bounds: boundsForProject(config) } }, 32);
      const source = { ...fixture, sourceKind: "real" as const, datasetVersion: "topostack-browser-e2e-v1" };
      const exported = await buildProjectPackage(generateGeometry(config, source), config).master.blob.text();
      const frame = await showPreview(page, html, previewResult(project));
      const figure = frame.locator("#figure svg");
      await expect(figure).toBeVisible({ timeout: 30_000 });
      const { previewLines, exportLines, previewBorder, exportBorder } = await figure.evaluate((svg, exported) => {
        const file = new DOMParser().parseFromString(exported, "image/svg+xml");
        const paths = (root: ParentNode, selector: string) => [...root.querySelectorAll(selector)].map((path) => path.getAttribute("d")!).sort();
        const border = (element: Element | null) => element && [element.localName, ...["x", "y", "width", "height"].map((name) => element.getAttribute(name))];
        return {
          previewLines: paths(svg, "path"),
          exportLines: paths(file, 'path[id^="contour-"]'),
          previewBorder: border(svg.querySelector("rect, circle")),
          exportBorder: border(file.querySelector("#engraving-border")),
        };
      }, exported);
      expect(previewLines).toEqual(exportLines);
      expect(previewBorder).toEqual(exportBorder);
      expect(Boolean(previewBorder)).toBe(showEngravingBorder);
      if (showEngravingContours) {
        // The fixture draws both closed interiors and lines clipped by the crop.
        const fragments = previewLines.flatMap((path) => path.split("M").filter(Boolean).map((part) => part.split("L")));
        expect(fragments.some((points) => points[0] === points.at(-1))).toBe(true);
        expect(fragments.some((points) => points[0] !== points.at(-1))).toBe(true);
      } else {
        expect(previewLines).toHaveLength(0);
      }
    }
  }
});
