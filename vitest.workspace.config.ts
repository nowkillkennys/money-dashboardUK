import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/workspace/**/*.test.ts"], fileParallelism: false, testTimeout: 20000 },
});
