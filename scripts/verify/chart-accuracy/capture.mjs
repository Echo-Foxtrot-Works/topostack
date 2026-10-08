// Isolated diagnostic use of the real preview component; not a full UI workflow.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { appUrl } from '../../lib/app-url.mjs';
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 820 }, deviceScaleFactor: 1 });
  await page.goto(appUrl('CHART_STRESS_URL'));
  const vector = JSON.parse(await readFile('scripts/data/depth-charts/usgs-lake-viking-2019.json'));
  const raster = JSON.parse(await readFile('scripts/verify/chart-accuracy/fixtures/viking-crop-record.json')).record;
  const scores = JSON.parse(await readFile('.topostack/chart-accuracy/accuracy-results.json'));
  const percentage = id => (scores.find(s => s.scenario === id).spatial20m.withinOneNormalizedSheet * 100).toFixed(1);
  const caption = `Independent QA comparison: raster ${percentage('viking-crop')}% · curated vector ${percentage('viking-curated-vector')}% within one normalized depth layer.`;
  const result = await page.evaluate(async ({ vector, raster, caption }) => {
    await import('/src/lib/studio/styles/preview.css');
    await import('/src/lib/studio/styles/overlays.css');
    const { mount } = await import('/node_modules/.vite/deps/svelte.js');
    const { default: Preview } = await import('/src/lib/studio/customdata/ChartDepth3D.svelte');
    const { representativeChartGeometry } = await import('/src/lib/studio/customdata/chart-stack.ts');
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:#fafafa;color:#17232b;padding:24px;font-family:Arial,sans-serif';
    root.innerHTML = '<h1 style="font-size:23px;margin:0 0 12px">Lake Viking — actual representative fabrication previews</h1><p>' + caption + '</p><p>Diagnostic component capture. Survey tracks only; not approval for physical cutting or whole-lake accuracy.</p>';
    const row = document.createElement('div'); row.style.cssText='display:flex;gap:24px;height:610px';root.append(row);document.body.append(root);
    window.__previewFailures = [];
    const receipts = [];
    for (const [title, record] of [['Browser raster crop — inaccurate basin distribution', raster], ['Curated vector + control points — stronger QA agreement', vector]]) {
      const panel=document.createElement('div');panel.style.cssText='width:50%;min-width:0;display:flex;flex-direction:column;border:1px solid #cbd5df';
      const heading=document.createElement('h2');heading.style.cssText='font-size:16px;padding:12px;margin:0';heading.textContent=title;panel.append(heading);
      const target=document.createElement('div');target.style.cssText='flex:1;min-height:0';panel.append(target);row.append(panel);
      mount(Preview,{target,props:{grid:record.grid,onUnavailable:()=>window.__previewFailures.push(title)}});
      const geometry=representativeChartGeometry(record.grid);
      receipts.push({title,layers:geometry.layers.length,widthMm:geometry.widthMm,heightMm:geometry.heightMm,polygons:geometry.layers.map(l=>l.polygons.length)});
    }
    return receipts;
  }, { vector, raster, caption });
  await expect(page.locator('canvas').filter({ visible: true }).first()).toBeVisible();
  await page.waitForTimeout(4000);
  const failures = await page.evaluate(() => window.__previewFailures);
  if (failures.length) throw new Error(`Preview unavailable: ${failures.join(', ')}`);
  await page.screenshot({ path: 'docs/images/real-depth-charts/viking-fabrication-comparison.png' });
  await writeFile('.topostack/chart-accuracy/preview-receipt.json', JSON.stringify({result,failures},null,2));
  console.log(JSON.stringify({result,failures}));
} finally { await browser.close(); }
