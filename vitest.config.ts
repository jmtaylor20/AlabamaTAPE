import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Policy tests share one database; run test files one at a time everywhere.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "policies",
          include: ["tests/policies/**/*.test.ts"],
          environment: "node",
          testTimeout: 30000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
