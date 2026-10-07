// Optional live-map integration: imports the exported reviewed chart in fresh storage.
import { readFile, writeFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { appUrl } from '../../lib/app-url.mjs';
const project = await readFile('.topostack/walden-example/walden-project.json');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`${appUrl('CHART_STRESS_URL')}/studio`);
  await page.locator('input[type=file][accept="application/json,.json"]').setInputFiles({ name: 'walden-project.json', mimeType: 'application/json', buffer: project });
  await expect(page.getByText('Project imported with its depth chart · generate to refresh its terrain', { exact: true }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole('button', { name: 'Generate terrain', exact: true }).click();
  await expect(page.getByText('Ready to export', { exact: true }).first()).toBeVisible({ timeout: 180000 });
  await page.getByRole('radio', { name: '3D stack', exact: true }).click();
  await page.screenshot({ path: 'docs/images/walden-example/walden-generated-terrain.png' });
  const text = await page.locator('body').innerText();
  // The warning stack shows two items at a time. Retain the initial warnings
  // in the screenshot, then reveal lower-priority provenance to verify use.
  const chartWarning = page.getByText('Some lake floors come from a traced depth chart. They are only as accurate as the chart and its tracing.', { exact: true });
  const warnings = [];
  for (let i = 0; i < 8 && !await chartWarning.isVisible(); i++) {
    const dismiss = page.getByRole('button', { name: /^Dismiss warning:/ }).first();
    if (!await dismiss.isVisible()) break;
    warnings.push(await dismiss.getAttribute('aria-label'));
    await dismiss.click();
  }
  await expect(chartWarning).toBeVisible();
  warnings.push(await chartWarning.innerText());
  await writeFile('.topostack/walden-example/walden-terrain-receipt.json', JSON.stringify({ errors, warnings, text }, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile('docs/images/walden-example/walden-project.json', project);
  console.log(text);
} finally { await browser.close(); }
