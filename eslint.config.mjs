import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

/**
 * Architectural boundaries, enforced rather than documented:
 *
 *   src/shared      isomorphic. May not reach into server, worker, or UI code.
 *   src/components  \
 *   src/features     } browser code. May import server modules for types only.
 *   src/app (UI)    /
 *   src/server      never imported by the worker's transport-free core, and
 *                   never imports React UI.
 */
const serverOnlyPatterns = [
  { group: ["@/server/*", "@/server/**"], message: "Server code cannot be imported into browser code. Use `import type` for DTO types.", allowTypeImports: true },
  { group: ["@/worker/*", "@/worker/**"], message: "Worker code cannot be imported into browser code." },
  { group: ["@/generated/prisma/client"], message: "Import enums from '@/shared' or types via `import type`; the Prisma client is server-only.", allowTypeImports: true },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports", fixStyle: "inline-type-imports" }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    files: ["src/components/**/*.{ts,tsx}", "src/features/**/*.{ts,tsx}", "src/shared/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-restricted-imports": ["error", { patterns: serverOnlyPatterns }],
    },
  },
  {
    files: ["src/server/**/*.ts", "src/worker/**/*.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [{ group: ["@/components/*", "@/features/*", "@/components/**", "@/features/**"], message: "Server and worker code must not depend on UI code." }] },
      ],
    },
  },
  {
    // Operational scripts and the seed talk to the terminal on purpose.
    files: ["scripts/**", "prisma/**", "tests/**", "e2e/**"],
    rules: { "no-console": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "coverage/**", "next-env.d.ts", "src/generated/**", "playwright-report/**", "test-results/**"]),
]);

export default eslintConfig;
