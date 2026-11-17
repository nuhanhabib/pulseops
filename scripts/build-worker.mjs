/**
 * Bundles the processes that run outside Next.js (worker, seed, demo target
 * simulator) into plain ESM files under dist/, so production containers run
 * `node dist/worker.mjs` without a TypeScript toolchain.
 */
import { build } from "esbuild";

await build({
  entryPoints: { worker: "src/worker/main.ts", seed: "prisma/seed.ts", "demo-targets": "scripts/demo-targets.ts", "demo-ctl": "scripts/demo-ctl.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // Dependencies stay in node_modules: native modules and their loaders must not be inlined.
  packages: "external",
  sourcemap: true,
  logLevel: "info",
});
