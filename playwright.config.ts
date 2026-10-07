import { defineConfig, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

// macOS 27 protects Firefox's normal app-data directory even when Playwright
// supplies a fresh -profile. Keep test startup metadata in this checkout.
// https://bugzilla.mozilla.org/show_bug.cgi?id=2060476
const firefoxAppData = fileURLToPath(new URL("./node_modules/.cache/topostack/firefox-app-data/", import.meta.url));
if (process.platform === "darwin") mkdirSync(firefoxAppData, { recursive: true });

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  timeout: 60_000,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "line" : "list",
  outputDir: "test-results",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "firefox",
      use: {
        ...devices["Desktop Firefox"],
        // Linux CI provides an Xvfb display and Mesa software rendering.
        // Use the display for Firefox so map tests exercise WebGL2 rendering.
        headless: !(process.env.CI && process.platform === "linux"),
        launchOptions: {
          firefoxUserPrefs: { "webgl.force-enabled": true },
          ...(process.platform === "darwin" ? { env: { ...process.env, MOZ_APP_DATA: firefoxAppData } } : {}),
        },
      },
    },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    // Build in the dedicated "e2e" Vite mode: the deterministic terrain fixture
    // in data-provider.ts requires both VITE_E2E=1 and a non-production mode.
    // CI builds once (the e2e-build job) and sets E2E_PREBUILT on every shard.
    command: `${process.env.E2E_PREBUILT === "1" ? "" : "npm run build:e2e -w @topostack/generator && "}npm run preview -w @topostack/generator -- --host 127.0.0.1 --port 4173`,
    url: "http://127.0.0.1:4173",
    env: { VITE_E2E: "1", VITE_SITE_ENV: "production" },
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
