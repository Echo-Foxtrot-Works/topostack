import type { Page } from "@playwright/test";

/**
 * Shows a settings panel. On a portrait phone the panels live in a bottom sheet
 * that starts closed, and a tap on the tab that is already open closes it, so
 * this taps again when the sheet ends up closed. Elsewhere it selects the tab.
 */
export async function showPanel(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", { name, exact: true });
  const viewport = page.viewportSize();
  // SettingsRail marks the sheet once it has hydrated on a phone; a tap before then would be lost.
  if (viewport && viewport.width <= 760 && viewport.height >= 600) await page.locator(".settings-rail[data-sheet]").waitFor({ state: "attached" });
  await tab.click();
  if (await page.locator('.settings-rail[data-sheet="closed"]').count()) await tab.click();
}

/**
 * Shows one step of the export dialog. A layered export opens on Panels and a
 * flat engraving on Download; the step list reaches any step directly.
 */
export async function showExportStep(page: Page, name: "Panels" | "Sheets" | "Download" | "Share"): Promise<void> {
  await page.getByRole("dialog", { name: "Export your project" }).getByRole("button", { name: new RegExp(`^Step \\d of \\d: ${name}$`) }).click();
}
