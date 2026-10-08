import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      reportsDirectory: "coverage",
      thresholds: { statements: 95, branches: 89, functions: 97, lines: 98 },
    },
  },
});
