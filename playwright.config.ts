import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);

/**
 * End-to-end tests run against the full stack: the web app, the worker, and
 * the demo target simulator, on the seeded demo database.
 *
 *   npm run build && npm run db:seed && npm run test:e2e
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${port}`, trace: "off", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The production server, as deployed: run `npm run build` first.
    command: `npx concurrently -k -n web,worker,targets "next start -p ${port}" "tsx src/worker/main.ts" "tsx scripts/demo-targets.ts"`,
    url: `http://localhost:${port}/api/v1/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { APP_URL: `http://localhost:${port}`, MONITOR_ALLOWED_PRIVATE_HOSTS: "localhost:4010", LOG_LEVEL: "warn" },
  },
});
