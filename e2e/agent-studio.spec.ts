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
  const { explodedPreview: _preview, ...design } = { ...DEFAULT_PROJECT, name: "Agent ridge", materialThicknessMm: 4 };
  const link = new URL(shareUrl(design, "http://127.0.0.1:4173/studio", "?generate=1"));
  await page.goto(`${link.pathname}${link.search}${link.hash}`);
  // The link is consumed so a refresh restores later edits rather than generating again.
  // That happens once the studio has started, which takes about five seconds on
  // a slow CI runner, so the default five-second poll is not enough.
  await expect.poll(() => page.evaluate(() => location.search), { timeout: 30_000 }).toBe("");
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
