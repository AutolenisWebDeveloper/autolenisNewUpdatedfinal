/**
 * Migration-chain drift gate.
 *
 * Answers the question CI could not answer before: if you provision a database
 * from `prisma/migrations` alone, do you get the schema the application expects?
 *
 * Until 2026-08 nothing ran the chain at all — CI had no database job — so the
 * chain drifted from schema.prisma unnoticed and `prisma migrate deploy` failed
 * at migration 22 of 94 on a fresh provision. A new environment, a preview
 * branch, and a restore-from-zero were all impossible.
 *
 * Two gates, deliberately different in strictness:
 *
 *   FUNCTIONAL (hard zero) — a chain-built database must never be MISSING a
 *   table, column, or enum value that schema.prisma declares. These are the
 *   differences that make application code throw at runtime; there is no
 *   acceptable non-zero level, so any occurrence fails the build.
 *
 *   STRUCTURAL (ratchet) — index names, index shape, foreign-key re-creation,
 *   column type normalisation, and objects the chain creates that the schema no
 *   longer declares. Closing these requires DROP statements aimed at a
 *   production database whose real state is not inspectable from CI, so they are
 *   not fixed here. Instead the count is pinned: it may never grow, and when it
 *   shrinks the baseline must be lowered, so the number can only ratchet down.
 *
 *   pnpm exec tsx scripts/check-migration-drift.ts
 *
 * Requires DATABASE_URL to point at a database already built by
 * `prisma migrate deploy` from an EMPTY state.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCHEMA = join(ROOT, "prisma", "schema.prisma");
const BASELINE_PATH = join(ROOT, "prisma", "drift-baseline.json");

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required — point it at a chain-built database.");
  process.exit(1);
}

function drift(): string {
  return execFileSync(
    "pnpm",
    [
      "exec", "prisma", "migrate", "diff",
      "--from-url", process.env.DATABASE_URL!,
      "--to-schema-datamodel", SCHEMA,
      "--script",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

const sql = drift();

// A difference is FUNCTIONAL when the schema declares something the chain-built
// database does not have. Statements that DROP or rename are structural: the
// database has more than the schema, or has it under another name.
const functional = {
  "missing table": [...sql.matchAll(/^CREATE TABLE "([^"]+)"/gm)].map((m) => m[1]),
  "missing column": [...sql.matchAll(/ADD COLUMN\s+"([^"]+)"/g)].map((m) => m[1]),
  "missing enum value": [...sql.matchAll(/^ALTER TYPE "([^"]+)" ADD VALUE '([^']+)'/gm)].map(
    (m) => `${m[1]}.${m[2]}`,
  ),
};

const structuralCount = sql.split("\n").filter((l) => /^(CREATE|ALTER|DROP)\b/.test(l)).length;

const baseline: { structuralStatements: number; note?: string } = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : { structuralStatements: Number.MAX_SAFE_INTEGER };

let failed = false;

console.log("Migration-chain drift (database built from prisma/migrations vs schema.prisma)\n");

for (const [label, items] of Object.entries(functional)) {
  if (items.length === 0) {
    console.log(`  ok       ${label}: 0`);
    continue;
  }
  failed = true;
  console.log(`  FAIL     ${label}: ${items.length}`);
  for (const i of items) console.log(`             - ${i}`);
}

console.log(
  `\n  structural statements: ${structuralCount} (baseline ${baseline.structuralStatements})`,
);

if (structuralCount > baseline.structuralStatements) {
  failed = true;
  console.error(
    `\nFAIL: structural drift grew by ${structuralCount - baseline.structuralStatements}. ` +
      `A migration changed the database in a way schema.prisma does not describe, or a ` +
      `schema change shipped without a matching migration.`,
  );
} else if (structuralCount < baseline.structuralStatements) {
  failed = true;
  console.error(
    `\nFAIL: structural drift IMPROVED to ${structuralCount}. Lower ` +
      `"structuralStatements" in prisma/drift-baseline.json to ${structuralCount} so the ` +
      `ratchet holds the gain.`,
  );
}

if (failed) {
  console.error("\nFull diff written by: prisma migrate diff --from-url $DATABASE_URL " +
    "--to-schema-datamodel prisma/schema.prisma --script");
  process.exit(1);
}

console.log("\nOK — no functional drift; structural drift at baseline.");
