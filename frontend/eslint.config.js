import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

/** @type {import("eslint").Linter.Config[]} */
const config = [
  {
    ignores: ["node_modules/**", ".next/**", "prisma/seed.ts", "*.js", "*.mjs", "*.cjs"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-unused-vars": "off",
      "no-console": "off",
    },
  },
  {
    // All of lib/ must route logging through lib/logger (structured, queryable).
    // lib/ is console-free as of the Phase 3 migration; this ratchet prevents
    // regressions. (app/ and components/ are not yet migrated — future work.)
    files: ["lib/**/*.ts", "lib/**/*.tsx"],
    rules: {
      "no-console": "warn",
    },
  },
  {
    // The logger itself is the console sink — it must use console.
    files: ["lib/logger.ts"],
    rules: {
      "no-console": "off",
    },
  },
];

export default config;
