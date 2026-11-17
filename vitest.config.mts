import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(import.meta.dirname, "src") };

/**
 * Three projects:
 *   unit         pure logic, no I/O
 *   integration  real Postgres and Redis (a dedicated test database)
 *   components   React components in jsdom
 */
export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      { resolve: { alias }, test: { name: "unit", environment: "node", include: ["tests/unit/**/*.test.ts"] } },
      {
        resolve: { alias },
        test: {
          name: "integration", environment: "node", include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/helpers/global-setup.ts"], setupFiles: ["tests/helpers/integration-setup.ts"],
          // One database, so files run one at a time.
          fileParallelism: false, testTimeout: 30_000, hookTimeout: 60_000,
        },
      },
      { plugins: [react()], resolve: { alias }, test: { name: "components", environment: "jsdom", include: ["tests/components/**/*.test.tsx"], setupFiles: ["tests/helpers/components-setup.ts"] } },
    ],
  },
});
