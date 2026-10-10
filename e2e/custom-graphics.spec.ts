import { expect, test } from "@playwright/test";

const BADGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><path d="M10 50 L35 10 L50 32 L62 18 L90 50 Z"/><circle cx="75" cy="15" r="7"/></svg>`;

test.beforeEach(async ({ page }) => {
  await page.route("https://static-res.makextool.com/**", (route) => route.abort());
  await page.route("**/v1/**", (route) => route.abort("internetdisconnected"));
  await page.goto("/studio");
  await page.getByRole("radio", { name: "Custom data", exact: true }).click();
  await page.getByRole("tab", { name: "Graphics", exact: true }).click();
});

test("an uploaded graphic is placed, turned and cut out on the preview as one edit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.locator("[data-graphic-import]").setInputFiles({ name: "club-badge.svg", mimeType: "image/svg+xml", buffer: Buffer.from(BADGE) });
  await expect(page.getByRole("textbox", { name: "Name for graphic club badge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Place graphics" })).toBeVisible();

  await page.getByLabel("Uploaded graphics").getByRole("button", { name: "Place" }).click();
  const handle = page.locator('[data-placeable^="graphic:"]');
  await expect(handle).toBeVisible();
  await expect(page.getByRole("button", { name: "Undo", exact: true }), "placing pauses history").toBeDisabled();
  await handle.focus();
  await page.keyboard.press("BracketRight");
  await page.keyboard.press("Shift+ArrowLeft");
  await expect(page.locator(".placement-toolbar")).toContainText("15°");
  await page.getByRole("radiogroup", { name: "What the laser does with this graphic" }).getByRole("radio", { name: "Cut" }).click();
  await expect(page.locator(".placement-cut-draft").first()).toBeVisible();

  // A second copy from the toolbar, then removed again with Delete.
  await page.getByRole("combobox", { name: "Add a graphic to the piece" }).selectOption({ label: "club badge" });
  await expect(handle).toHaveCount(2);
  await page.keyboard.press("Delete");
  await expect(handle).toHaveCount(1);

  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator("[data-placement-layer]")).toHaveCount(0, { timeout: 15_000 });
  const placed = page.getByLabel("Graphics on the piece");
  await expect(placed).toContainText("15°");
  await expect(placed.getByRole("radio", { name: "Cut" })).toHaveAttribute("aria-checked", "true");

  // One Undo takes the whole placement back.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(placed).toHaveCount(0);
  expect(errors).toEqual([]);
});
