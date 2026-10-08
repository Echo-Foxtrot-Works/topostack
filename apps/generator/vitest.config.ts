import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

// Node-environment tests. Browser tests are the *.client.test.ts files and run
// under jsdom via vitest.client.config.ts.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Let Vite resolve the theme's font assets (`?url`) instead of Node loading them.
    server: { deps: { inline: ["@loidolt/theme-styles"] } },
    exclude: [...configDefaults.exclude, "src/**/*.client.test.ts"],
    coverage: {
      reportsDirectory: "coverage/node",
      thresholds: { statements: 90, branches: 84, functions: 91, lines: 94 },
    },
  },
}));
