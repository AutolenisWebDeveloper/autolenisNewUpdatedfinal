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

const structuralLines = sql.split("\n").filter((l) => /^(CREATE|ALTER|DROP)\b/.test(l));

type Deferred = { contains: string; reason: string; closesIn: string; expectedMatches?: number };
const baseline: {
  structuralStatements: number;
  note?: string;
  deferredStatements?: Deferred[];
} = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
  : { structuralStatements: Number.MAX_SAFE_INTEGER };

// An ENUMERATED exception, not a raised ceiling. A statement is excused only if it
// contains one of the exact strings declared in drift-baseline.json, each of which
// names why it is deferred and the phase that closes it. Every other statement is
// still gated by `structuralStatements`, so this cannot become a general loophole.
//
// A deferred entry that matches NOTHING is itself a failure: the deferral has been
// closed (or was never real) and the entry must be deleted, so the list cannot rot
// into a permanent excuse for drift that no longer exists.
const deferred = baseline.deferredStatements ?? [];
const deferredHits = new Map<string, number>();
const structural = structuralLines.filter((line) => {
  const hit = deferred.find((d) => line.includes(d.contains));
  if (!hit) return true;
  deferredHits.set(hit.contains, (deferredHits.get(hit.contains) ?? 0) + 1);
  return false;
});
const structuralCount = structural.length;

const staleDeferrals = deferred.filter((d) => !deferredHits.has(d.contains));
// A deferral that matches MORE often than declared has silently widened to cover a statement it was
// never written for — the failure mode of a `contains` string that cannot be anchored to its table.
const widenedDeferrals = deferred.filter(
  (d) => (deferredHits.get(d.contains) ?? 0) > (d.expectedMatches ?? 1),
);

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
if (deferred.length > 0) {
  const n = [...deferredHits.values()].reduce((a, b) => a + b, 0);
  console.log(`  deferred by explicit exception: ${n} statement(s) across ${deferredHits.size} entr(ies)`);
  for (const d of deferred) {
    const c = deferredHits.get(d.contains) ?? 0;
    console.log(`    ${c > 0 ? "-" : "!"} [${d.closesIn}] ${d.contains}${c > 0 ? "" : "  (MATCHES NOTHING)"}`);
  }
}
if (widenedDeferrals.length > 0) {
  failed = true;
  for (const d of widenedDeferrals) {
    console.error(
      `\nFAIL: deferred exception "${d.contains}" matched ${deferredHits.get(d.contains)} statements ` +
        `but declares expectedMatches ${d.expectedMatches ?? 1}. It has widened beyond what it was ` +
        `written for — narrow the string or raise the count deliberately.`,
    );
  }
}
if (staleDeferrals.length > 0) {
  failed = true;
  console.error(
    `\nFAIL: ${staleDeferrals.length} deferred drift exception(s) match nothing. The deferral is ` +
      `closed — delete the entry from prisma/drift-baseline.json so the list cannot rot into a ` +
      `standing excuse.`,
  );
}

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
