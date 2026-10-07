import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_PROJECT } from "@topostack/core";
import { shareUrl } from "@topostack/data-contracts/share-link";

type ToolResult = { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };

async function blockNetwork(page: Page) {
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
}

test("opens an assistant's studio link and generates it straight away", async ({ page }) => {
  await blockNetwork(page);
  // TEMPORARY DIAGNOSTICS: record every history write and page error.
  const diagnostics: string[] = [];
  page.on("pageerror", (error) => diagnostics.push(`pageerror ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" || message.type() === "warning") diagnostics.push(`console.${message.type()} ${message.text().slice(0, 300)}`); });
  await page.addInitScript(() => {
    const log: string[] = ((window as unknown as { __urlLog: string[] }).__urlLog = []);
    for (const name of ["replaceState", "pushState"] as const) {
      const original = history[name].bind(history);
      history[name] = (state: unknown, title: string, url?: string | URL | null) => {
        log.push(`${performance.now().toFixed(0)}ms ${name} ${String(url).slice(0, 80)} :: ${(new Error().stack ?? "").split("\n").slice(2, 6).map((line) => line.trim().slice(0, 120)).join(" | ")}`);
        return original(state, title, url);
      };
    }
    addEventListener("popstate", () => log.push(`${performance.now().toFixed(0)}ms popstate ${location.href.slice(0, 80)}`));
  });
  const { explodedPreview: _preview, ...design } = { ...DEFAULT_PROJECT, name: "Agent ridge", materialThicknessMm: 4 };
  const link = new URL(shareUrl(design, "http://127.0.0.1:4173/studio", "?generate=1"));
  await page.goto(`${link.pathname}${link.search}${link.hash}`);
  // The link is consumed so a refresh restores later edits rather than generating again.
  // Read the document's own location: the studio can rewrite it before the
  // initial navigation settles, and page.url() may not see that rewrite.
  try { await expect.poll(() => page.evaluate(() => location.search)).toBe(""); }
  catch (error) {
    const history = await page.evaluate(() => (window as unknown as { __urlLog: string[] }).__urlLog);
    console.log(`URL DIAGNOSTICS\nlocation=${await page.evaluate(() => location.href.slice(0, 120))}\n${history.join("\n")}\n${diagnostics.join("\n")}\nstatus=${await page.locator(".status-line").first().textContent().catch(() => "?")}`);
    throw error;
  }
  await expect.poll(() => page.evaluate(() => location.hash)).toBe("");
  // Export stays closed until fresh terrain is generated, so an enabled package proves the link generated.
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("button", { name: /Complete project/ })).toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("dialog")).toContainText("Agent ridge");
});

test("offers the studio's tools to a browser agent through WebMCP", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebMCP is a Chromium API; the stand-in only needs one engine.");
  await blockNetwork(page);
  await page.addInitScript(() => {
    const tools = new Map<string, { execute: (input: unknown) => Promise<unknown> }>();
    (window as unknown as { agentTools: typeof tools }).agentTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(tool: { name: string; execute: (input: unknown) => Promise<unknown> }, options?: { signal?: AbortSignal }) {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener("abort", () => tools.delete(tool.name));
        },
      },
    });
  });
  const call = (name: string, input: Record<string, unknown> = {}) => page.evaluate(([tool, args]) =>
    (window as unknown as { agentTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).agentTools.get(tool)!.execute(args), [name, input] as const) as Promise<ToolResult>;

  await page.goto("/studio");
  // The tools register once the studio has mounted and loaded its WebMCP chunk, which waits behind
  // startup work; on a busy CI runner that takes longer than the default five seconds.
  await expect.poll(() => page.evaluate(() => (window as unknown as { agentTools: Map<string, unknown> }).agentTools.size), { timeout: 30_000 }).toBe(7);

  const before = await call("topostack_get_design");
  expect(before.structuredContent).toMatchObject({ design: { output: "layered", materialThicknessMm: DEFAULT_PROJECT.materialThicknessMm } });

  const updated = await call("topostack_update_design", { materialThicknessMm: 6, details: { roads: false } });
  expect(updated.isError).toBeFalsy();
  const generated = await call("topostack_generate_preview");
  expect(generated.isError).toBeFalsy();
  expect(generated.structuredContent).toMatchObject({ design: { materialThicknessMm: 6, details: { roads: false } }, generation: "ready" });
  expect((generated.structuredContent as { sheets?: number }).sheets).toBeGreaterThanOrEqual(2);

  await call("topostack_undo");
  expect((await call("topostack_get_design")).structuredContent).toMatchObject({ design: { details: { roads: true } } });

  expect((await call("topostack_update_design", { materialThicknessMm: 90 })).isError).toBe(true);

  await call("topostack_open_export");
  await expect(page.getByRole("dialog")).toBeVisible();
});
