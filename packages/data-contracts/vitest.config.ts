import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      reportsDirectory: "coverage",
      thresholds: { statements: 94, branches: 90, functions: 96, lines: 96 },
    },
  },
});
