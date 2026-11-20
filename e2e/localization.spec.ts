import { expect, test, type FrameLocator, type Page } from "@playwright/test";

// Atomm reviews the generator in all 18 platform languages and rejects any
// English left on screen (docs/localization.md). The pseudo-locale renders
// every catalog message as ⟦Àççéñţéđ⟧, so English outside those brackets is
// copy that never went through t().

const STARTUP_TIMEOUT_MS = 30_000;

// Names that are not copy: the product, data sources, formats, units, file
// names and the test harness's own export button.
const ALLOWED = [
  /\bTopoStack\b/g, /\bOpenStreetMap( contributors)?\b/g, /\b(FAA|PAD-US|GLOBathy|HydroLAKES|USGS|NOAA|Copernicus|Esri|Mapzen|Terrarium|SRTM|NASADEM|NBS|CHS|SYKE|swisstopo|CanVec|Natural Earth|sparrow)\b/g,
  /\b(SVG|GPX|KML|KMZ|GeoJSON|CSV|PDF|PNG|ZIP|JSON|HTML|DEM|AGL|MSL|VFR|MOA|MOAs)\b/g, /\bxTool Studio\b/g, /\bAtomm\b/g, /\bLightBurn\b/g,
  /\b(mm|cm|km|ft|in|m)\b/g, /[\w-]+\.(svg|json|txt|html|zip|gpx|kml|geojson)\b/g, /\bPlatform Export\b/g,
  /\b(Inter|Noto Sans|Roboto|Lato|Oswald|Merriweather|Playfair Display|Source Serif|Space Grotesk|Bebas Neue|Cinzel|Montserrat|Open Sans|Raleway|Libre Baskerville)\b/g,
];

async function openEmbed(page: Page, locale: string): Promise<FrameLocator> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route("**/v1/**", route => route.abort("internetdisconnected"));
  await page.route("https://static-res.makextool.com/**", route => route.fulfill({ contentType: "application/javascript", body: `
    window.atomm = {
      lifecycle: { on(event, hook) { window.testExport = hook; } },
      app: { getLocale: async () => ${JSON.stringify(locale)}, getSupportedLocales: async () => [] },
      ui: { toast: async () => 'toast', closeToast: async () => {} }
    };
    const render = () => document.querySelectorAll('[data-atomm-export-button]').forEach(slot => {
      if (!slot.firstChild) { const button = document.createElement('button'); button.textContent = 'Platform Export'; slot.append(button); }
    });
    new MutationObserver(render).observe(document.documentElement, { childList: true, subtree: true }); render();
  ` }));
  await page.route("**/atomm-test", route => route.fulfill({ contentType: "text/html", body: '<html><body style="margin:0"><iframe title="Atomm generator" src="/studio" style="width:100%;height:100vh;border:0;display:block"></iframe></body></html>' }));
  await page.goto("/atomm-test");
  const studio = page.frameLocator("iframe");
  await expect(studio.locator(".atomm-workbench")).toBeVisible({ timeout: STARTUP_TIMEOUT_MS });
  return studio;
}

/** Every visible-copy string in the workbench that is English outside the pseudo brackets. */
async function englishLeft(studio: FrameLocator): Promise<string[]> {
  const found = await studio.locator("body").evaluate((body) => {
    const out: string[] = [];
    const skip = (element: Element | null) => Boolean(element?.closest("svg, canvas, .maplibregl-ctrl-attrib, .project-name, [data-i18n-skip], option[data-font], script, style"));
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim();
      if (text && !skip(node.parentElement)) out.push(text);
    }
    for (const element of body.querySelectorAll("[aria-label], [title], [placeholder], [alt]")) {
      if (skip(element)) continue;
      for (const name of ["aria-label", "title", "placeholder", "alt"]) {
        const value = element.getAttribute(name)?.trim();
        if (value) out.push(`@${name}: ${value}`);
      }
    }
    return out;
  });
  const leftover = (text: string) => {
    // Attribute entries are reported as "@name: value"; only the value is copy.
    let rest = text.replace(/^@[\w-]+: /, "").replace(/⟦[^⟧]*⟧/g, " ");
    for (const pattern of ALLOWED) rest = rest.replace(pattern, " ");
    return /[A-Za-z]{3,}/.test(rest);
  };
  return [...new Set(found.filter(leftover))];
}

async function expandEverything(studio: FrameLocator): Promise<void> {
  await studio.locator("body").evaluate((body) => body.querySelectorAll<HTMLElement>('.section-disclosure[aria-expanded="false"], details:not([open]) > summary').forEach((element) => element.click()));
}

test("every string the Atomm embed shows goes through the message catalog", async ({ page }) => {
  test.setTimeout(240_000);
  const studio = await openEmbed(page, "qps-ploc");
  await expect(studio.locator("html")).toHaveAttribute("lang", "en");
  const leftovers = new Set<string>();
  const collect = async () => { for (const text of await englishLeft(studio)) leftovers.add(text); };
  for (const output of ["Layered", "Flat"]) {
    await studio.locator(".output-mode-switch [role='radio']").nth(output === "Layered" ? 0 : 1).click();
    const views = await studio.locator(".mode-switch [role='radio']").count();
    for (let view = 0; view < views; view += 1) {
      const radio = studio.locator(".mode-switch [role='radio']").nth(view);
      if (await radio.isDisabled()) continue;
      await radio.click();
      await page.waitForTimeout(500);
      await expandEverything(studio);
      await collect();
      // Conditional settings appear only once their switch is on: turn every switch on, then look again.
      await studio.locator(".gen-params-content").evaluate((content) => content.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:not(:checked):not(:disabled)').forEach((box) => box.click()));
      await page.waitForTimeout(1500);
      await expandEverything(studio);
      await collect();
    }
  }
  // Dialogs the lead rail opens.
  await studio.locator(".location-card, button:has(.lucide-search)").first().click();
  await page.waitForTimeout(500);
  await collect();
  expect([...leftovers].sort(), "English copy that bypasses t()").toEqual([]);
});

// Every platform language: the copy is that language, the document says so,
// and the longest translations (German, Russian, Thai…) still fit the rails.
const LOCALE_TAGS: Record<string, string> = { zh: "zh", "zh-hant": "zh-Hant", de: "de", es: "es", fr: "fr", it: "it", ja: "ja", ko: "ko", ru: "ru", uk: "uk", sl: "sl", th: "th", pl: "pl", cs: "cs", id: "id", vi: "vi", "pt-BR": "pt-BR" };

for (const [locale, tag] of Object.entries(LOCALE_TAGS)) {
  test(`the embed runs in ${locale} and fits its rails`, async ({ page }) => {
    test.setTimeout(120_000);
    const studio = await openEmbed(page, locale);
    await expect(studio.locator("html")).toHaveAttribute("lang", tag);
    await expandEverything(studio);
    // The parameter rail's section titles are translated, not English.
    const titles = await studio.locator(".gen-params-content .section-disclosure").allInnerTexts();
    expect(titles.length).toBeGreaterThan(4);
    // Some titles are spelled the same in English ("Aviation", French "Fabrication"); most must not be.
    const english = ["Cut size", "Terrain layers", "Map features", "Water", "Aviation (US)", "Labels and marks", "Fabrication"];
    expect(titles.filter((title) => english.includes(title.trim())).length, `English section titles in ${locale}: ${titles.join(" | ")}`).toBeLessThanOrEqual(1);
    // Nothing spills sideways out of either 320 px rail or out of a control row.
    const overflow = await studio.locator("body").evaluate(() => {
      const out: string[] = [];
      for (const rail of document.querySelectorAll<HTMLElement>(".gen-rail-lead, .gen-rail-params")) {
        if (rail.scrollWidth > rail.clientWidth + 1) out.push(`${rail.className} scrolls sideways (${rail.scrollWidth} > ${rail.clientWidth})`);
        const box = rail.getBoundingClientRect();
        for (const element of rail.querySelectorAll<HTMLElement>("button, label, input, select, .field-row, .atomm-switch-row, .ldt-toggle-group__item")) {
          const rect = element.getBoundingClientRect();
          if (!rect.width || element.closest("[hidden]")) continue;
          if (rect.right > box.right + 1 || rect.left < box.left - 1) out.push(`${element.textContent?.trim().slice(0, 40) || element.getAttribute("aria-label")} overflows its rail`);
          if (element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowX === "visible" && element.matches("button, .ldt-toggle-group__item")) out.push(`${element.textContent?.trim().slice(0, 40)} text overflows its control (${element.scrollWidth} > ${element.clientWidth})`);
        }
      }
      return [...new Set(out)];
    });
    expect(overflow, `layout problems in ${locale}`).toEqual([]);
    // The Export view's contents card wraps its longer lines instead of scrolling sideways.
    const exportView = studio.locator(".mode-switch [role='radio']").last();
    if (await exportView.isEnabled()) {
      await exportView.click();
      const manifest = studio.locator(".export-manifest");
      if (await manifest.isVisible({ timeout: 30_000 }).catch(() => false)) {
        expect(await manifest.evaluate((card) => card.scrollWidth - card.clientWidth), `export card scrolls sideways in ${locale}`).toBeLessThanOrEqual(1);
      }
    }
  });
}
