import { DEFAULT_PROJECT } from "@topostack/core";
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
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === "topostack:project:v1") throw new DOMException("Test interrupted primary write", "AbortError");
      return put.call(this, value, key);
    };
  });
  await page.addInitScript(() => {
    const raw = localStorage.getItem("topostack:project:v1:unload-copy");
    if (raw) sessionStorage.setItem("unload-marker-count", String(JSON.parse(raw).value.markers?.length));
  });
  await openMarkers(page);
  await page.getByRole("button", { name: "Add marker", exact: true }).click();
  const size = page.getByRole("spinbutton", { name: "Marker 1 size", exact: true });
  await expect(size).toHaveValue("8");
  // The primary copy cannot be updated on this page. Verify the synchronous handoff itself.
  await page.reload();
  expect(await page.evaluate(() => sessionStorage.getItem("unload-marker-count"))).toBe("1");
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

for (const scenario of ["aborted read", "damaged primary"] as const) {
  test(`recovers from ${scenario} and persists subsequent edits across reload`, async ({ page }) => {
    await page.goto("/version.json");
    const expected = scenario === "aborted read" ? "Original design" : "Last edit";
    await page.evaluate(async ({ scenario, project }) => {
      const key = "topostack:project:v1";
      const open = indexedDB.open("keyval-store");
      open.onupgradeneeded = () => open.result.createObjectStore("keyval");
      const db = await new Promise<IDBDatabase>((resolve) => { open.onsuccess = () => resolve(open.result); });
      const tx = db.transaction("keyval", "readwrite");
      const store = tx.objectStore("keyval");
      store.put({ ...project, name: "Original design", ...(scenario === "damaged primary" ? { widthMm: "bad" } : {}) }, key);
      store.put(1, key + ":saved-at");
      await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
      db.close();
      if (scenario === "damaged primary") localStorage.setItem(key + ":unload-copy", JSON.stringify({ savedAt: 2, value: { ...project, name: "Last edit" } }));
    }, { scenario, project: DEFAULT_PROJECT });
    if (scenario === "aborted read") await page.addInitScript(() => {
      const get = IDBObjectStore.prototype.get;
      IDBObjectStore.prototype.get = function (key) {
        const request = get.call(this, key);
        if (key === "topostack:project:v1" && !sessionStorage.getItem("aborted-read")) {
          sessionStorage.setItem("aborted-read", "1");
          // idb-keyval queues both reads synchronously. Abort after both requests exist.
          queueMicrotask(() => this.transaction.abort());
        }
        return request;
      };
    });
    await openStudio(page);
    const name = page.getByRole("textbox", { name: "Project name", exact: true });
    await expect(name).toHaveValue(expected);
    if (scenario === "aborted read") {
      expect(await page.evaluate(() => sessionStorage.getItem("aborted-read"))).toBe("1");
    }
    const editedName = expected + " after recovery";
    await name.fill(editedName);
    await name.press("Tab");
    await expect.poll(() => page.evaluate(async () => {
      const open = indexedDB.open("keyval-store");
      const db = await new Promise<IDBDatabase>((resolve) => { open.onsuccess = () => resolve(open.result); });
      const store = db.transaction("keyval").objectStore("keyval");
      const get = (key: string) => new Promise((resolve) => { const r = store.get("topostack:project:v1" + key); r.onsuccess = () => resolve(r.result); });
      const [primary, backup, savedAt] = await Promise.all([get(""), get(":unreadable-backup"), get(":saved-at")]);
      db.close();
      return { primary, backup, wrote: Number(savedAt) > 2, unloaded: localStorage.getItem("topostack:project:v1:unload-copy") };
    }), { timeout: 30_000 }).toMatchObject({
      primary: { name: editedName },
      backup: scenario === "damaged primary" ? { value: { name: "Original design", widthMm: "bad" } } : undefined,
      wrote: true,
      unloaded: null,
    });
    await page.reload();
    await expect(name).toHaveValue(editedName);
  });
}
