import * as nextEnvModule from "@next/env";

/**
 * Loads .env files for processes that do not run inside Next.js (the worker,
 * the seed, scripts), using Next's own loader so precedence is identical.
 * Import this first, before any module that reads `process.env`.
 */
// @next/env is CommonJS. Depending on the loader (tsx, esbuild, Node ESM) its exports arrive
// either as named exports or under `default`, so accept both.
const { loadEnvConfig } = ((nextEnvModule as { default?: typeof nextEnvModule }).default ?? nextEnvModule) as typeof nextEnvModule;
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });
