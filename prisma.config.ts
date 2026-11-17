import * as nextEnvModule from "@next/env";
import { defineConfig } from "prisma/config";

// Prisma 7 no longer reads .env on its own. Reuse Next's loader so the CLI,
// the web app, the worker, and the tests all resolve env files the same way.
// @next/env is CommonJS. Depending on the loader (tsx, esbuild, Node ESM) its exports arrive
// either as named exports or under `default`, so accept both.
const { loadEnvConfig } = ((nextEnvModule as { default?: typeof nextEnvModule }).default ?? nextEnvModule) as typeof nextEnvModule;
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` runs on install (and in the Docker build) where no
    // database is configured. Only commands that connect need a real URL.
    url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
});
