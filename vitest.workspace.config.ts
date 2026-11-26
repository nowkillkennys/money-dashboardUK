import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globalSetup: ["./tests/workspace/setup.ts"],
    include: ["tests/workspace/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 20000,
  },
});
