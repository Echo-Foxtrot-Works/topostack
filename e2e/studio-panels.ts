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
