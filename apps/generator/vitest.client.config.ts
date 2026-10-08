import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [sveltekit()],
  resolve: { conditions: ["browser"] },
  test: {
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost/" } },
    include: ["src/lib/**/*.client.test.ts"],
    // Let Vite resolve the theme's font assets (`?url`) instead of Node loading them.
    server: { deps: { inline: ["@loidolt/theme-styles"] } },
    testTimeout: 20_000,
    coverage: {
      reportsDirectory: "coverage/client",
      thresholds: { statements: 65, branches: 50, functions: 68, lines: 63 },
    },
  },
});
