// Scratch audit of the Atomm embed against a running e2e preview build.
// Usage: node atomm-audit.mjs <origin> <outdir>
import { chromium, firefox, webkit } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";

const origin = process.argv[2] ?? "http://127.0.0.1:4174";
const out = process.argv[3] ?? "./out";
await mkdir(out, { recursive: true });
const sizes = [[1600, 1000], [1280, 900], [960, 800], [700, 900], [390, 844], [320, 640], [844, 390]];
const results = [];

for (const [name, type] of [["chromium", chromium], ["firefox", firefox], ["webkit", webkit]]) {
  const browser = await type.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, colorScheme: "light", reducedMotion: "reduce", hasTouch: name === "chromium" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/v1/**", r => r.abort());
  await page.route("https://static-res.makextool.com/**", r => r.fulfill({ contentType: "application/javascript", body: "window.atomm = { lifecycle: { on() {} }, app: { getLocale: async () => 'en' } };" }));
  await page.route("**/atomm-audit-frame", r => r.fulfill({ contentType: "text/html", body: '<body style="margin:0"><iframe src="/studio" style="width:100vw;height:100vh;border:0;display:block"></iframe></body>' }));
  await page.goto(`${origin}/atomm-audit-frame`);
  const studio = page.frameLocator("iframe");
  await studio.locator(".status-line").filter({ hasText: "Real terrain ready" }).waitFor({ timeout: 60_000 });
  for (const mode of ["Layered relief", "Flat engraving"]) {
    await studio.getByRole("radio", { name: mode, exact: true }).click();
    await studio.locator(".gen-params-content").evaluate(el => el.querySelectorAll('.section-disclosure[aria-expanded="false"]').forEach(b => b.click()));
    for (const [w, h] of sizes) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(400);
      const report = await page.frames()[1].evaluate(() => {
        const doc = document.documentElement;
        const vis = s => [...document.querySelectorAll(s)].filter(e => e.getBoundingClientRect().height > 0).length;
        const overflowing = [...document.querySelectorAll(".gen-params-content *")].filter(e => {
          const r = e.getBoundingClientRect(), p = document.querySelector(".gen-params-content").getBoundingClientRect();
          return r.width > 0 && (r.right > p.right + 1 || r.left < p.left - 1);
        }).slice(0, 5).map(e => `${e.tagName.toLowerCase()}.${[...e.classList].join(".")}`);
        const text = document.body.innerText;
        return {
          pageOverflowX: doc.scrollWidth > doc.clientWidth + 1,
          standaloneRail: vis(".settings-rail"), sheetBar: vis(".settings-sheet-bar"), appShell: vis(".app-shell"),
          mentionsLightBurn: /lightburn|\.lbrn/i.test(text),
          panelOverflow: overflowing,
          viewTabs: [...document.querySelectorAll('[role="radio"]')].filter(e => e.getBoundingClientRect().height > 0 && /^(2D|3D|Export|Engraving|Map)$/.test(e.textContent.trim())).length,
          frameUrl: location.pathname,
        };
      });
      results.push({ browser: name, mode, size: `${w}x${h}`, ...report });
      if (name === "chromium") await page.screenshot({ path: `${out}/${mode.split(" ")[0].toLowerCase()}-${w}x${h}.png` });
    }
  }
  // Export view: what the platform's export shows.
  await page.setViewportSize({ width: 1280, height: 900 });
  await studio.getByRole("radio", { name: "Layered relief", exact: true }).click();
  const exportTab = studio.getByRole("radio", { name: "Export", exact: true });
  if (await exportTab.count()) {
    await exportTab.click();
    await page.waitForTimeout(3000);
    const t = await page.frames()[1].evaluate(() => document.body.innerText);
    results.push({ browser: name, exportView: true, mentionsLightBurn: /lightburn|\.lbrn/i.test(t) });
    if (name === "chromium") await page.screenshot({ path: `${out}/export-1280.png` });
  }
  results.push({ browser: name, pageErrors: errors });
  await browser.close();
}
await writeFile(`${out}/results.json`, JSON.stringify(results, null, 2));
const bad = results.filter(r => r.pageOverflowX || r.standaloneRail || r.sheetBar || r.appShell || r.mentionsLightBurn || r.panelOverflow?.length || r.pageErrors?.length);
console.log(`${results.length} checks, ${bad.length} flagged`);
console.log(JSON.stringify(bad, null, 1));
