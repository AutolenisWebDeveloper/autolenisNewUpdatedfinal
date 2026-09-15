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

  // ── verify.sql's terminal row must state the number of rows it really emits ──────────────
  //
  // WHY. The terminal row exists so "this file produced no output" is distinguishable from
  // "this file passed" — it is the anti-vacuity assertion of the SQL. Its numbers were typed
  // by hand and went stale twice: the 13/3 split never matched the file, and the 16 total went
  // stale the moment the ledger CTE grew from two names to four. A typed count drifting beside
  // a hand-written list, inside the file whose subject is a typed count drifting beside a
  // hand-written list.
  //
  // So it is computed here instead. One row per assertion, N per VALUES list, one per name in
  // the phase8_expected CTE.

  /** The file with every full-line `--` comment removed. Comments carry apostrophes
   *  ("verify.sql's", "nobody checked it"), and an apostrophe in a comment desynchronises any
   *  quote-state scan of the SQL below it. Stripping first is not tidiness, it is correctness:
   *  the first draft of this parser masked before stripping and found 4 statements instead of
   *  16 — caught only by the anti-vacuity assertion below, which is #7 happening a third time. */
  function withoutComments(sql: string): string {
    return sql
      .split("\n")
      .filter((l) => !/^\s*(--|\\pset)/.test(l))
      .join("\n");
  }

  /** Blank out SQL string literals, preserving length, so a `;` inside one is not a terminator. */
  function maskLiterals(sql: string): string {
    let out = "";
    let inStr = false;
    for (const c of sql) {
      if (c === "'") {
        inStr = !inStr;
        out += "'";
      } else {
        out += inStr && c !== "\n" ? " " : c;
      }
    }
    return out;
  }

  /** Top-level statements, as slices of the comment-stripped text. */
  function statements(sql: string): string[] {
    const body = withoutComments(sql);
    const masked = maskLiterals(body);
    const out: string[] = [];
    let start = 0;
    for (let i = 0; i < masked.length; i++) {
      if (masked[i] === ";") {
        out.push(body.slice(start, i).trim());
        start = i + 1;
      }
    }
    return out.filter((st) => st.startsWith("SELECT") || st.startsWith("WITH"));
  }

  /** How many rows one statement emits. */
  function rowsEmitted(stmt: string): number {
    const fromValues = stmt.match(/FROM \(VALUES([\s\S]*?)\)\s*AS\s+\w+\(/);
    if (fromValues) return (fromValues[1]!.match(/\('/g) ?? []).length;
    if (/FROM phase8_expected\s+AS\s+\w+/.test(stmt)) {
      return (stmt.match(/\('20261117\d{6}_phase8_/g) ?? []).length;
    }
    return 1;
  }

  test("verify.sql's terminal row states the number of rows the file actually emits", () => {
    const sql = readFileSync(join(PROOF_DIR, "verify.sql"), "utf8");
    const stmts = statements(sql);

    // ANTI-VACUITY, and it is not decoration — it has now fired twice in this one file, on two
    // different broken scans (§8.1h #7). A parser that finds no statements makes every count
    // below 0 === 0, green forever, guarding nothing.
    assert.ok(
      stmts.length >= 15,
      `parsed only ${stmts.length} statements from verify.sql — the parser is broken, not the file`,
    );

    // The ledger half is the half that reads `_prisma_migrations`. Classifying on that rather
    // than on a comment banner means a reworded heading cannot silently reclassify an assertion.
    let physical = 0;
    let ledger = 0;
    let terminal = 0;
    for (const stmt of stmts) {
      const rows = rowsEmitted(stmt);
      if (stmt.includes("verify complete")) terminal += rows;
      else if (stmt.includes("_prisma_migrations")) ledger += rows;
      else physical += rows;
    }

    assert.ok(physical > 0, "counted zero physical assertions — the parser is broken");
    assert.ok(ledger > 0, "counted zero ledger assertions — the parser is broken");
    assert.equal(terminal, 1, `expected exactly one terminal row, counted ${terminal}`);

    const stated = sql.match(/'(\d+) assertions: (\d+) physical, (\d+) ledger\./);
    assert.ok(stated, "verify.sql's terminal row no longer states 'N assertions: P physical, L ledger.'");

    const total = physical + ledger + terminal;
    assert.deepEqual(
      { total: Number(stated[1]), physical: Number(stated[2]), ledger: Number(stated[3]) },
      { total, physical, ledger },
      `verify.sql's terminal row claims ${stated[1]} assertions (${stated[2]} physical, ${stated[3]} ledger) but ` +
        `the file emits ${total} rows (${physical} physical, ${ledger} ledger, 1 terminal). The terminal row is ` +
        `what distinguishes a verify that ran from one that produced nothing — a wrong count there is the defect ` +
        `this whole directory is about.`,
    );
  });
});
