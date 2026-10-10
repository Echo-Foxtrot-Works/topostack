import { expect, test, type Page } from "@playwright/test";

// The page's first autosave has finished, so autosave is running and an edit
// from here on has only its own write between it and the next load.
async function waitForAutosave(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => new Promise<unknown>((resolve) => {
    const open = indexedDB.open("keyval-store");
    // Creating the database here would leave idb-keyval without its store.
    open.onupgradeneeded = () => open.transaction?.abort();
    open.onerror = () => resolve(undefined);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains("keyval")) { db.close(); resolve(undefined); return; }
      const read = db.transaction("keyval").objectStore("keyval").get("topostack:project:v1:saved-at");
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); resolve(undefined); };
    };
  })), { timeout: 30_000 }).toEqual(expect.any(Number));
}

async function openStudio(page: Page): Promise<void> {
  await page.route("**/v1/**", route => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", route => route.abort("internetdisconnected"));
  // Autosave does not depend on live basemap fonts or tiles.
  await page.route("https://tiles.openfreemap.org/styles/**", route => route.fulfill({ json: {
    version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#e9e5da" } }],
  } }));
  await page.goto("/studio");
}

async function openMarkers(page: Page): Promise<void> {
  await page.getByRole("radio", { name: "Custom data", exact: true }).click();
  await page.getByRole("tab", { name: "Markers", exact: true }).click();
}

test("an edit made just before a reload survives it", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await openStudio(page);
  await waitForAutosave(page);
  await openMarkers(page);
  await page.getByRole("button", { name: "Add marker", exact: true }).click();
  const size = page.getByRole("spinbutton", { name: "Marker 1 size", exact: true });
  await expect(size).toHaveValue("8");
  // No wait: the 450 ms debounce has not fired, so only the unload flush can save it.
  await page.reload();
  await openMarkers(page);
  await expect(size).toHaveValue("8");

  // A second edit on the restored page, reloaded just as quickly.
  await waitForAutosave(page);
  await size.fill("42");
  await size.press("Tab");
  await page.reload();
  await openMarkers(page);
  await expect(size).toHaveValue("42");
  expect(errors).toEqual([]);
});

test("an edit made just before the tab closes is there in the next tab", async ({ context }) => {
  const first = await context.newPage();
  await openStudio(first);
  await waitForAutosave(first);
  await openMarkers(first);
  await first.getByRole("button", { name: "Add marker", exact: true }).click();
  await expect(first.getByRole("spinbutton", { name: "Marker 1 size", exact: true })).toHaveValue("8");
  await first.close();

  const next = await context.newPage();
  await openStudio(next);
  await openMarkers(next);
  await expect(next.getByRole("spinbutton", { name: "Marker 1 size", exact: true })).toHaveValue("8");
});
