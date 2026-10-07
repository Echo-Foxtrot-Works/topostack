import { fileURLToPath } from "node:url";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Matches the wrangler.jsonc alias: core's project subpath from source.
  resolve: { alias: { "@topostack/core/project": fileURLToPath(new URL("../../packages/core/src/project/index.ts", import.meta.url)) } },
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "istanbul",
      reportsDirectory: "coverage",
      thresholds: { statements: 93, branches: 86, functions: 97, lines: 95 },
    },
  },
});
