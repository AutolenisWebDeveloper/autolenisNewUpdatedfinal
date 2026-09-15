// The Phase 8 proof SQL must name EVERY Phase 8 migration — checked against the directories
// on disk, not against a list someone remembered to update.
//
// WHY THIS EXISTS. `docs/transaction-flow/phase-8-proof/verify.sql` named only the first two
// of the phase's four migrations, in two separate hardcoded lists, with a remedy line reading
// "two applied rows, one per migration". It was written when the phase had two and never
// updated when `executed_copy_storage` and `invited_signer_token` were added.
//
// It UNDER-ASSERTED rather than mis-asserted: every row it printed was true, and it would
// have reported a clean verify on a production deploy with HALF THE MIGRATIONS MISSING. That
// is the defect class §8.1h names — "something reported success while checking nothing" —
// found by the owner's independent verification at 17:33 UTC, sitting inside the proof
// directory the class was documented in.
//
// A list maintained by hand drifted once and will drift again, so the fix is not just to add
// the two names. This test is the loop-closer: add a Phase 8 migration without updating
// verify.sql and the build fails here, naming the file and the missing migration.
//
// Run: npx tsx --test "prisma/__tests__/phase8-proof-sql.test.ts"

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// process.cwd(), matching every sibling test in this directory — `test:migrations` runs from
// `frontend/`, and `import.meta.dirname` is undefined under this tsx/node configuration.
const APP_ROOT = process.cwd();
const REPO_ROOT = join(APP_ROOT, "..");
const MIGRATIONS_DIR = join(APP_ROOT, "prisma", "migrations");
const PROOF_DIR = join(REPO_ROOT, "docs", "transaction-flow", "phase-8-proof");

/** Every Phase 8 migration directory, from disk. The 2026111700 prefix is the phase's wave. */
function phase8MigrationsOnDisk(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => /^20261117\d{6}_phase8_/.test(d))
    .sort();
}

/** Every migration name this SQL file mentions, deduplicated. */
function migrationsNamedIn(file: string): string[] {
  const sql = readFileSync(join(PROOF_DIR, file), "utf8");
  return [...new Set([...sql.matchAll(/'(20261117\d{6}_phase8_[a-z0-9_]+)'/g)].map((m) => m[1]!))].sort();
}

describe("phase 8 proof SQL names every phase 8 migration", () => {
  test("the migrations exist on disk at all — the fixture is not empty", () => {
    const found = phase8MigrationsOnDisk();
    // Guards THIS test against the very defect it exists to catch: a regex that matches
    // nothing would make every assertion below vacuously true.
    //
    // IT ALREADY DID. The first draft used `2026111700\d{2}_phase8_`, two digits short of the
    // 14-digit stamp these directories carry, so `onDisk` and `named` were both EMPTY and the
    // two comparison tests passed by comparing nothing to nothing. A drift guard that cannot
    // see the thing it guards is the same defect it was written to catch, one level up. This
    // assertion is the only reason that was noticed rather than committed.
    assert.ok(found.length >= 4, `expected at least 4 phase 8 migrations, found ${found.length}: ${found.join(", ")}`);
  });

  test("verify.sql names every phase 8 migration on disk", () => {
    const onDisk = phase8MigrationsOnDisk();
    const named = migrationsNamedIn("verify.sql");
    const missing = onDisk.filter((m) => !named.includes(m));
    assert.deepEqual(
      missing,
      [],
      `verify.sql does not name ${missing.join(", ")}. A verify that omits a migration reports ` +
        `a clean deploy with that migration missing — add it to the phase8_expected list.`,
    );
  });

  test("verify.sql names no migration that does not exist", () => {
    const onDisk = phase8MigrationsOnDisk();
    const named = migrationsNamedIn("verify.sql");
    const phantom = named.filter((m) => !onDisk.includes(m));
    assert.deepEqual(
      phantom,
      [],
      `verify.sql names ${phantom.join(", ")}, which is not a directory under prisma/migrations. ` +
        `A verify asserting a migration that cannot apply fails every run for the wrong reason.`,
    );
  });

  test("verify.sql states no hardcoded count of phase 8 migrations", () => {
    // The original file said "two applied rows, one per migration" beside a two-name list, and
    // both went stale together. The count is now derived from the list in SQL; a literal here
    // is the shape that drifts, so it is refused.
    const sql = readFileSync(join(PROOF_DIR, "verify.sql"), "utf8");
    const literals = [...sql.matchAll(/\b(two|three|four|five)\s+applied\s+rows\b/gi)].map((m) => m[0]);
    assert.deepEqual(
      literals,
      [],
      `verify.sql hardcodes a migration count (${literals.join(", ")}). Derive it from the ` +
        `phase8_expected list instead — a literal beside a list is how this file drifted.`,
    );
  });

  test("the proof files the migration package promises are all present", () => {
    // MIGRATION-PACKAGE.md's sequence tells the owner to run these by name. A package naming a
    // file that is not there is a runbook that stops halfway through a production deploy.
    for (const f of ["preflight.sql", "verify.sql", "MIGRATION-PACKAGE.md"]) {
      assert.ok(existsSync(join(PROOF_DIR, f)), `${f} is named in the migration package and must exist`);
    }
  });
});
