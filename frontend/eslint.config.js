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
    // lib/, app/, and components/ must route logging through lib/logger
    // (structured, queryable). These trees are console-free as of the Phase 3
    // migration; this ratchet prevents regressions. (scripts/ and config files
    // may still use console.)
    files: ["lib/**/*.ts", "lib/**/*.tsx", "app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx"],
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
  {
    // ONE READER FOR THE PUBLIC INTAKE ANSWER.
    //
    // POST /api/public/request-vehicle returns three materially different
    // outcomes as the same HTTP 200. Four surfaces each hand-rolled the fetch and
    // its interpretation, and three of them read `res.ok` alone — so a capture
    // that attached to nothing fired an ad conversion and rendered "Request
    // Received!". `submitVehicleRequest` in lib/api/client.ts is the single
    // reader; this rule is what stops a fifth caller from appearing.
    //
    // Scoped to the intake endpoint exactly: `/api/public/request-vehicle/complete`
    // is a different contract with a different answer, and is not covered.
    files: ["app/**/*.ts", "app/**/*.tsx", "components/**/*.ts", "components/**/*.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.name='fetch'] > Literal[value=/^\\u002Fapi\\u002Fpublic\\u002Frequest-vehicle(\\?|$)/]",
          message:
            "Do not fetch /api/public/request-vehicle directly — call submitVehicleRequest() from lib/api/client. It returns an IntakeOutcome you have to switch on, so a capture that persisted nothing cannot be read as a success.",
        },
        {
          selector:
            "CallExpression[callee.name='fetch'] > TemplateLiteral > TemplateElement[value.raw=/^\\u002Fapi\\u002Fpublic\\u002Frequest-vehicle(\\?|$)/]",
          message:
            "Do not fetch /api/public/request-vehicle directly — call submitVehicleRequest() from lib/api/client. It returns an IntakeOutcome you have to switch on, so a capture that persisted nothing cannot be read as a success.",
        },
      ],
    },
  },
];

export default config;
