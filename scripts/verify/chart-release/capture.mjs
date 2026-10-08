// Real source + an explicitly prepared review draft. This is not a claim that
// the app automatically discovers the fixture's corrections or coordinates.
import { readFile, writeFile } from 'node:fs/promises';
import { sha256Hex } from '../../lib/hash.mjs';
import { chromium, expect } from '@playwright/test';
import { appUrl } from '../../lib/app-url.mjs';
const source = JSON.parse(await readFile('scripts/verify/chart-release/king-city-reviewed.json'));
const lake = JSON.parse(await readFile('scripts/verify/chart-accuracy/fixtures/king-city-lake.json'));
const input = '.topostack/chart-accuracy/king-city-crop.png';
const bytes = await readFile(input);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  await page.goto(`${appUrl('CHART_STRESS_URL')}/studio`);
  await page.getByRole('radio', { name: 'Custom data', exact: true }).click();
  await page.evaluate(async lake => { const { draft } = await import('/src/lib/studio/customdata/chart-draft.svelte.ts'); draft.lake = lake; }, lake);
  await page.locator('.chart-upload input').setInputFiles(input);
  await expect(page.locator('.chart-canvas')).toBeVisible();
  const size = await page.locator('.chart-canvas').evaluate(c => ({ width: c.width, height: c.height }));
  const [left, top, right, bottom] = source.crop;
  const sx = size.width / (right-left), sy = size.height / (bottom-top);
  const review = structuredClone(source.review);
  for (const c of review.contours) c.points = c.points.map(([x,y]) => [(x-left)*sx, (y-top)*sy]);
  for (const p of review.controlPoints) { p.x = (p.x-left)*sx; p.y = (p.y-top)*sy; }
  const draftFile = { schema: 'chart-review-draft-v1', source: { sha256: sha256Hex(bytes), page: 0, ...size, units: 'ft', reads: 'elevation', surface: '1028.5', interval: '2' }, review };
  await page.locator('.chart-review-restore input').setInputFiles({ name: 'king-reviewed.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(draftFile)) });
  await expect(page.getByRole('button', { name: 'Generate reviewed depths', exact: true })).toBeDisabled();
  await page.getByLabel('Select review contour', { exact: true }).selectOption(review.contours.find(c => !c.excluded && c.id !== review.shorelineId).id);
  await page.screenshot({ path: 'docs/images/chart-release/king-contour-editing.png' });
  await page.getByRole('button', { name: 'Alignment', exact: true }).click();
  await page.getByRole('checkbox', { name: 'I checked the alignment and orientation against the source.' }).check();
  await page.getByRole('button', { name: 'Generate reviewed depths', exact: true }).click();
  await expect(page.locator('.chart-report')).toContainText('100%');
  await expect(page.getByRole('button', { name: 'Keep this chart', exact: true })).toBeDisabled();
  await expect(page.locator('.depth-3d canvas:visible')).toBeVisible();
  await page.locator('.review-source [data-svg-viewport]').press('0');
  await page.locator('.review-editor').evaluate(el => { el.scrollTop = 0; });
  await page.screenshot({ path: 'docs/images/chart-release/king-reviewed-workspace.png' });
  await page.getByRole('checkbox', { name: 'I checked the generated basin and layers against the source.' }).check();
  const result = await page.evaluate(async () => { const { draft } = await import('/src/lib/studio/customdata/chart-draft.svelte.ts'); return JSON.parse(JSON.stringify(draft.result)); });
  await writeFile('.topostack/chart-release/king-browser-record.json', JSON.stringify(result));
  await page.getByRole('button', { name: 'Keep this chart', exact: true }).click();
  await expect(page.locator('.chart-saved')).toContainText('King');
  await page.locator('.chart-saved').screenshot({ path: 'docs/images/chart-release/king-reviewed-library.png' });
  await page.getByRole('button', { name: 'Use for King City South Lake', exact: true }).click();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Project settings/ }).click();
  const stream = await (await downloading).createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const exported = JSON.parse(Buffer.concat(chunks).toString());
  if (!exported.charts[0]?.review) throw new Error('Export lost the review receipt');
  const b = result.record.grid.bounds, dx = (b.east-b.west)*.12, dy = (b.north-b.south)*.12;
  exported.project.location = { lat: (b.north+b.south)/2, lon: (b.east+b.west)/2, label: 'King City South Lake, Missouri', zoom: 15, bounds: { west: b.west-dx, east: b.east+dx, south: b.south-dy, north: b.north+dy } };
  await writeFile('.topostack/chart-release/king-project.json', JSON.stringify(exported));
  console.log(JSON.stringify(result.report, null, 2));
} finally { await browser.close(); }
