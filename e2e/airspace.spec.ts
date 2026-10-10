import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";

test("builds airspace in acrylic over the model and exports its panels, rods and guide", async ({ page }) => {
  test.setTimeout(180_000);
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.route("**/v1/events", (route) => route.fulfill({ status: 204 }));
  await page.goto("/studio");
  await page.getByRole("button", { name: "Expand all" }).click();
  await page.getByRole("switch", { name: "Airspace in 3D", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Airspace in 3D", exact: true })).toBeChecked();
  await page.getByRole("combobox", { name: "Airspace form" }).selectOption("tiers");
  await page.getByRole("button", { name: /Generate terrain|Regenerate terrain/ }).click();
  await expect(page.locator(".status-line")).toContainText("Real terrain ready", { timeout: 60_000 });
  // The settings report what was built: pieces on levels, held by rods.
  await expect(page.locator(".airspace-settings")).toContainText(/\d+ pieces? on \d+ levels?/, { timeout: 30_000 });

  await page.getByRole("radio", { name: "Cut layers", exact: true }).click();
  await page.getByRole("combobox", { name: "Cut material", exact: true }).selectOption("airspace");
  await expect(page.getByRole("img", { name: "Airspace cut preview for level 1", exact: true })).toBeVisible();
  await expect(page.locator("[data-airspace-piece]").first()).toBeVisible();
  const picker = page.getByRole("slider", { name: "Selected airspace level", exact: true });
  await picker.focus();
  await picker.press("End");
  await expect(picker).toHaveValue(await picker.getAttribute("max") ?? "0");
  await expect(page.locator(".layer-heading")).toContainText("ft MSL");
  await page.getByRole("combobox", { name: "Cut material", exact: true }).selectOption("terrain");
  await expect(page.getByRole("slider", { name: "Selected layer", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Complete project/ }).click();
  const chunks: Buffer[] = [];
  for await (const chunk of await (await downloadPromise).createReadStream()) chunks.push(Buffer.from(chunk));
  const files = unzipSync(Buffer.concat(chunks));
  const names = Object.keys(files);
  expect(names.some((name) => /-airspace-blue-01\.svg$/.test(name))).toBe(true);
  expect(names.some((name) => /-airspace-blue-master\.svg$/.test(name))).toBe(true);
  const readme = Buffer.from(files["README.txt"]!).toString("utf8");
  expect(readme).toContain("Airspace in acrylic (tiers)");
  expect(readme).toContain("not for navigation");
  const guide = Buffer.from(Object.entries(files).find(([name]) => name.endsWith("-assembly-guide.html"))![1]).toString("utf8");
  expect(guide).toContain("Build the airspace");
  const manifest = JSON.parse(Buffer.from(Object.entries(files).find(([name]) => name.endsWith("-project.json"))![1]).toString("utf8"));
  expect(manifest.project.airspaceStack.form).toBe("tiers");
  expect(manifest.result.fabrication.airspaceStack.sectors.length).toBeGreaterThan(0);
  expect(manifest.result.fabrication.airspaceStack.levels.length).toBeGreaterThan(0);
});

test("builds the airspace a browser agent asks for, on through rods", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "WebMCP is a Chromium API; the stand-in only needs one engine.");
  test.setTimeout(180_000);
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort("internetdisconnected"));
  await page.addInitScript(() => {
    const tools = new Map<string, { execute: (input: unknown) => Promise<unknown> }>();
    (window as unknown as { agentTools: typeof tools }).agentTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool(tool: { name: string; execute: (input: unknown) => Promise<unknown> }) { tools.set(tool.name, tool); } },
    });
  });
  type ToolResult = { content: Array<{ text: string }>; structuredContent?: Record<string, unknown>; isError?: boolean };
  const call = (name: string, input: Record<string, unknown> = {}) => page.evaluate(([tool, args]) =>
    (window as unknown as { agentTools: Map<string, { execute: (input: unknown) => Promise<unknown> }> }).agentTools.get(tool)!.execute(args), [name, input] as const) as Promise<ToolResult>;

  await page.goto("/studio");
  await expect.poll(() => page.evaluate(() => (window as unknown as { agentTools: Map<string, unknown> }).agentTools.size), { timeout: 30_000 }).toBe(7);
  const updated = await call("topostack_update_design", { airspaceStack: { form: "tiers", rod: { joint: "through" } } });
  expect(updated.isError).toBeFalsy();
  const generated = await call("topostack_generate_preview");
  expect(generated.isError).toBeFalsy();
  const airspace = (generated.structuredContent as { airspace?: { form: string; pieces: number; rods: number } }).airspace;
  expect(airspace).toMatchObject({ form: "tiers" });
  expect(airspace!.pieces).toBeGreaterThan(0);
  expect(airspace!.rods).toBeGreaterThan(0);
  expect(generated.content[0]!.text).toMatch(/Airspace: \d+ acrylic pieces on \d+ levels \(tiers\)/);
  // The studio shows what the agent chose.
  await page.getByRole("button", { name: "Expand all" }).click();
  await expect(page.getByRole("switch", { name: "Airspace in 3D", exact: true })).toBeChecked();
  await expect(page.getByRole("combobox", { name: "Rod joint" })).toHaveValue("through");
});
