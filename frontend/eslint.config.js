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
    // Lifecycle-critical zones must route logging through lib/logger (structured,
    // queryable). This is the ratchet seam — extend the glob list as other zones
    // are migrated off raw console.* (see _completion gap analysis, Gap 10).
    files: [
      "lib/services/deal/**/*.ts",
      "lib/services/esign/**/*.ts",
      "lib/services/pickup/**/*.ts",
      "lib/services/payment/**/*.ts",
      "lib/services/deposit/**/*.ts",
    ],
    rules: {
      "no-console": "warn",
    },
  },
];

export default config;
