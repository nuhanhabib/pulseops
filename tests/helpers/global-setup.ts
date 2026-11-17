import { execSync } from "node:child_process";

import { applyTestEnv, TEST_DATABASE_URL } from "./test-env";

/** Applies migrations to the test database once per run. */
export default function setup() {
  applyTestEnv();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL } });
}
