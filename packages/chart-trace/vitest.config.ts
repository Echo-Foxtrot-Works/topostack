import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    coverage: {
      reportsDirectory: "coverage",
      thresholds: { statements: 97, branches: 91, functions: 97, lines: 98 },
    },
  },
});
