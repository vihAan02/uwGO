import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Tools that run through Vitest because they need the app's own modules, but are not tests: they take
 * their inputs from the environment and print a report. `npm run campus:regression` is one.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.tool.ts"],
    testTimeout: 600_000,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
