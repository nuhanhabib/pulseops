/** Environment for integration tests. Imported before any application module. */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://pulseops:pulseops@localhost:5432/pulseops_test";

export function applyTestEnv(): void {
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    // A separate Redis database, so tests never touch development queues or limits.
    REDIS_URL: process.env.TEST_REDIS_URL ?? "redis://localhost:6379/9",
    APP_URL: "http://localhost:3000",
    LOG_LEVEL: "silent",
    MONITOR_ALLOWED_PRIVATE_HOSTS: "",
    AI_PROVIDER: "none",
    ALLOW_SIGNUP: "true",
    SMTP_URL: "",
  });
}
