import { pageSecurityPolicy } from "../scripts/lib/static-headers.mjs";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

test("homepage explains the product without JavaScript", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Turn real terrain into");
  await expect(page.getByRole("link", { name: "Start creating", exact: true })).toHaveCount(3);
  for (const link of await page.getByRole("link", { name: "Start creating", exact: true }).all()) {
    // Inspect the HTML attribute so this works with JavaScript disabled in Firefox.
    const href = await link.getAttribute("href");
    expect(new URL(href ?? "", baseURL).href).toBe(`${baseURL}/studio`);
  }
  await page.getByText("View data sources and credits").click();
  await expect(page.getByRole("link", { name: "OpenStreetMap contributors" })).toBeVisible();
  await context.close();
});

test("homepage stays lightweight and opens the studio under the built CSP", async ({ page, baseURL }) => {
  const headers = readFileSync("apps/generator/dist/_headers", "utf8");
  const policy = pageSecurityPolicy(headers, "/")?.replace("; upgrade-insecure-requests", "");
  if (!policy) throw new Error("Missing production Content-Security-Policy header");
  const errors: string[] = [];
  const workers: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => workers.push(worker.url()));
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.route(`${baseURL}/`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), "content-security-policy": policy } });
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.getByRole("button", { name: /Color scheme/ }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("topostack-theme"))).not.toBeNull();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 375);
  expect(workers).toEqual([]);
  await expect(page.locator(".app-shell")).toHaveCount(0);
  await page.getByRole("link", { name: "See how it works" }).click();
  await expect(page).toHaveURL(/#how-it-works$/);
  await expect(page.getByRole("heading", { name: "Find it. Shape it. Make it." })).toBeInViewport();
  await page.getByRole("link", { name: "Try the terrain studio" }).click();
  await expect(page).toHaveURL(`${baseURL}/studio`);
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Studio menu/ }).click();
  const home = page.getByRole("menuitem", { name: /TopoStack home/ });
  await expect(home).toHaveAttribute("target", "_blank");
  await expect(home).toHaveJSProperty("href", `${baseURL}/`);
  // A return visit must restore page scrolling after editor CSS was loaded.
  await page.goBack();
  await page.getByRole("link", { name: "Make a donation" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("link", { name: "Make a donation" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("old About links redirect to the homepage", async ({ page, baseURL }) => {
  await page.goto("/about");
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Turn real terrain into");
});

test("direct studio visits restore saved project settings", async ({ page }) => {
  // Autosave starts once startup restore finishes, and headless Chromium then spends
  // seconds compiling the 3D preview's shaders in software, which delays the first
  // write well past the default five-second wait.
  const startup = { timeout: 30_000 };
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.goto("/studio");
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await name.fill("My saved landscape");
  await expect.poll(() => page.evaluate(() => new Promise<string | undefined>((resolve, reject) => {
    const request = indexedDB.open("keyval-store");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const read = db.transaction("keyval", "readonly").objectStore("keyval").get("topostack:project:v1");
      read.onsuccess = () => { db.close(); resolve(read.result?.name); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  })), startup).toBe("My saved landscape");
  await page.goto("/");
  await page.getByRole("link", { name: "Start creating", exact: true }).first().click();
  await expect(name).toHaveValue("My saved landscape", startup);
  await page.reload();
  await expect(name).toHaveValue("My saved landscape", startup);
});

test("mobile readers can navigate guides, examples and the studio with correct metadata", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  const events: Record<string, unknown>[] = [];
  await page.route("**/v1/events", async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ status: 204 });
  });
  await page.goto("/?utm_source=github");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow, max-image-preview:large");
  await page.getByRole("link", { name: "How to make a layered topographic map" }).click();
  await expect(page).toHaveTitle("How to Make a Laser-Cut Topographic Map | TopoStack");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://topostack.app/guides/laser-cut-topographic-map");
  // Guides carry article metadata, and it has to survive client-side navigation
  // rather than only appearing in the prerendered HTML.
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  await expect(page.locator('meta[property="article:modified_time"]')).toHaveAttribute("content", /^\d{4}-\d{2}-\d{2}$/);
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Layered map guide");
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole("navigation", { name: "Guides", exact: true })).toBeHidden();
  await page.getByText("Browse guides", { exact: true }).click();
  await page.getByRole("navigation", { name: "Guides menu" }).getByRole("link", { name: "Crater Lake example", exact: true }).click();
  await expect(page).toHaveTitle("Crater Lake Topographic Map: A Terrain Project | TopoStack");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Get started");
  await expect(page.getByRole("navigation", { name: "Previous and next guides" }).getByRole("link", { name: /Next\s*Layered map guide/ })).toBeVisible();
  await expect(page.locator("article img")).toBeVisible();
  await page.getByRole("link", { name: "Open Crater Lake in the studio", exact: true }).click();
  // The example link is consumed once the project opens, so a refresh keeps later edits.
  await expect(page).toHaveURL(baseURL + "/studio");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
  // Opening an example also starts its terrain generation, which reports its own events.
  await expect.poll(() => events.map((event) => event.event).slice(0, 3)).toEqual(["landing_view", "studio_open", "generation_started"]);
  expect(events.every((event) => event.source === "github" && event.landing === "/")).toBe(true);
});

test("a guide explains the workflow with JavaScript disabled", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/guides/topographic-map-engraving");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Create a topographic map SVG for laser engraving");
  await expect(page.getByText("The primary file ends in", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open the studio", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Guides", exact: true }).getByRole("link", { name: "Engraving guide" })).toHaveAttribute("aria-current", "page");
  await context.close();
});

test("lake depth pages list surveyed lakes without JavaScript and link into the studio", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/lakes/minnesota");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Minnesota lake depth maps");
  await page.getByRole("link", { name: "Crow Wing County", exact: true }).click();
  await expect(page).toHaveTitle("Crow Wing County, Minnesota Lake Depth Maps | TopoStack");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", "https://topostack.app/lakes/minnesota/crow-wing-county");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(/Lake depth maps\s*\/\s*Minnesota\s*\/\s*Crow Wing County/);
  await expect(page.getByRole("link", { name: "Open Pelican in the studio" }).first()).toHaveAttribute("href", /studio\?lake=Pelican&bounds=/);
  // Larger lakes have a page of their own, also without JavaScript.
  await page.getByRole("link", { name: "Pelican", exact: true }).first().click();
  await expect(page).toHaveURL(/\/lake\/pelican-crow-wing-county-minnesota/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pelican lake depth map");
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText(/Crow Wing County\s*\/\s*Pelican/);
  await expect(page.getByRole("link", { name: "Open Pelican in the studio" })).toHaveAttribute("href", /studio\?lake=Pelican&bounds=/);
  // The locator map is plain SVG, so it is there without JavaScript.
  await expect(page.getByRole("img", { name: /Map of where Pelican is in Crow Wing County, Minnesota/ })).toBeVisible();
  const graph = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent() ?? "{}")["@graph"];
  expect(graph).toContainEqual(expect.objectContaining({ "@type": "LakeBodyOfWater", name: "Pelican", containedInPlace: { "@type": "Place", name: "Crow Wing County, Minnesota" } }));
  await context.close();
});

test("the region index and the lake search both lead to a lake's own page", async ({ page }) => {
  await page.goto("/lakes");
  await page.getByRole("link", { name: "Mille Lacs", exact: true }).first().click();
  await expect(page).toHaveURL(/\/lake\/mille-lacs-mille-lacs-county-minnesota/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mille Lacs lake depth map");

  await page.goto("/guides/lake-depth-data");
  await page.getByLabel("Search lakes").fill("Crater Lake Oregon");
  const result = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Crater Lake", exact: true }) });
  await result.getByRole("link", { name: /^Lake page/ }).click();
  await expect(page).toHaveURL(/\/lake\/crater-lake-oregon/);
  await expect(page.getByRole("link", { name: "Open Crater Lake in the studio" })).toHaveAttribute("href", /studio\?lake=Crater\+Lake&bounds=/);
});

test("the example gallery leads to an example with its render, sharing card and importable project", async ({ page, request }) => {
  await page.goto("/examples");
  await expect(page).toHaveTitle("Topographic Map Examples: Laser-Cut Terrain Projects | TopoStack");
  await page.getByRole("link", { name: /Mount Fuji/ }).first().click();
  await expect(page).toHaveTitle("Mount Fuji Topographic Map: A Laser-Cut Project | TopoStack");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://topostack.app/images/examples/mount-fuji-card.jpg");
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  await expect(page.locator("article picture img")).toBeVisible();
  const download = page.getByRole("link", { name: "Download the project file" });
  const file = await (await request.get(new URL(await download.getAttribute("href") ?? "", page.url()).href)).json();
  expect(file.project).toMatchObject({ schemaVersion: 1, cropShape: "circle", outputMode: "stack" });
  expect(file.capture.layers).toBeGreaterThan(3);
});

test("an example opens in the studio with one click and Undo returns to the previous project", async ({ page, baseURL }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.goto("/examples/mount-fuji");
  const open = page.getByRole("link", { name: "Open in studio", exact: true });
  await expect(open).toHaveAttribute("href", /studio\?example=mount-fuji$/);
  await open.click();
  await expect(page).toHaveURL(baseURL + "/studio");
  const name = page.getByRole("textbox", { name: "Project name", exact: true });
  await expect(name).toHaveValue("Mount Fuji · TopoStack example");
  await expect(page.getByRole("button", { name: "Export", exact: true })).toBeVisible();
  // The example replaced the starting project as an ordinary, undoable change.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(name).toHaveValue("Crater Lake");
});

test("an example link that names no example leaves the studio on its current project", async ({ page, baseURL }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.goto("/studio?example=atlantis");
  // The link is resolved once startup restore finishes, which headless Chromium delays
  // past the default five seconds while it compiles the 3D preview's shaders in software.
  const startup = { timeout: 30_000 };
  await expect(page).toHaveURL(baseURL + "/studio", startup);
  await expect(page.getByText("Example not found · your project is unchanged")).toBeVisible(startup);
  await expect(page.getByRole("textbox", { name: "Project name", exact: true })).toHaveValue("Crater Lake");
});

test("the changelog lists releases newest first with a feed, without JavaScript", async ({ browser, baseURL }) => {
  const { releases } = JSON.parse(readFileSync(new URL("../changelog/releases.json", import.meta.url), "utf8"));
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL });
  const page = await context.newPage();
  await page.goto("/changelog");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Changelog");
  await expect(page.getByRole("heading", { level: 2 }).first()).toHaveText(`Version ${releases[0].version}`);
  // Production builds never show pending fragments.
  await expect(page.getByRole("heading", { name: "Unreleased" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Guides", exact: true }).getByRole("link", { name: "Changelog" })).toHaveAttribute("aria-current", "page");
  await expect(page.locator('link[rel="alternate"][type="application/atom+xml"]')).toHaveCount(1);
  const feed = await context.request.get("/changelog.xml");
  expect(feed.ok()).toBe(true);
  expect(await feed.text()).toContain(`<title>TopoStack ${releases[0].version}</title>`);
  await context.close();
});

test("the guides hub lists every guide and marks the current page in the sidebar", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByRole("link", { name: "Guides", exact: true }).first().click();
  await expect(page).toHaveURL(baseURL + "/guides");
  await expect(page).toHaveTitle("Topographic Map Guides and Documentation | TopoStack");
  await expect(page.getByRole("heading", { level: 2, name: "Lakes and depth" })).toBeVisible();
  await page.getByRole("main").getByRole("link", { name: /^How lake depths work/ }).click();
  const sidebar = page.getByRole("navigation", { name: "Guides", exact: true });
  await expect(sidebar.getByRole("link", { name: "How lake depths work" })).toHaveAttribute("aria-current", "page");
  const toc = page.getByRole("navigation", { name: "On this page" });
  await expect(toc.getByRole("link", { name: "Three kinds of information, different jobs" })).toHaveAttribute("href", "#sources-title");
  await toc.getByRole("link", { name: "How to read the result" }).click();
  await expect(toc.getByRole("link", { name: "How to read the result" })).toHaveAttribute("aria-current", "location");
  expect(await page.evaluate(() => document.body.scrollWidth <= innerWidth)).toBe(true);
});
