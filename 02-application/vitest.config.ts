import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    // `workers/**` is included on purpose: the reminder cron Worker carries its
    // own copy of the DB-resilience primitives (it is bundled separately), so
    // its tests are the only thing stopping the two copies from drifting.
    include: ["src/**/*.test.ts", "workers/**/*.test.ts"],
  },
});
