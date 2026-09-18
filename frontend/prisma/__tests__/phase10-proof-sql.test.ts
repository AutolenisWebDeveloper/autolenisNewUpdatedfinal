// The Phase 10 proof SQL must name EVERY Phase 10 migration — checked against the directories on
// disk, not against a list someone remembered to update.
//
// WHY THIS EXISTS. `docs/transaction-flow/phase-8-proof/verify.sql` named only the first two of
// that phase's four migrations, in two separate hardcoded lists. It UNDER-ASSERTED rather than
// mis-asserted: every row it printed was true, and it would have reported a clean deploy with
// HALF THE MIGRATIONS MISSING. Phase 10 ships TWO migrations and the risk is not theoretical
// here either: this package was written AFTER the deploy, from a list of two that already
// existed, which is the easiest possible case to get right and still no reason to leave it
// unguarded.
//
// AND THERE IS A SECOND REASON, specific to this phase. Phase 10 shipped with NO proof directory
// at all — the owner applied both migrations to production without a preflight because there was
// nothing to run, while phases 1 and 3 through 9 all had one. The package existing is what this
// file now makes checkable: PROOF_FILES below must all be present, and every Phase 10 migration
// directory must carry a rollback.sql. A phase that forgets the package again fails here rather
// than at 02:36 on the night of a deploy.
//
// THE PREFIX IS THE TRAP. Phase 8's equivalent guard first used `2026111700\d{2}_phase8_` —
// TWO DIGITS SHORT of the 14-digit stamp these directories carry — so `onDisk` and `named` were
// both EMPTY and its comparison tests passed by comparing nothing to nothing. A drift guard
// that cannot see the thing it guards is the same defect it was written to catch, one level up.
// `20261215` is 8 digits and the stamp is 14, so the pattern below takes `\d{6}` more. The
// anti-vacuity assertions are what prove that arithmetic rather than asserting it.
//
// Run: npx tsx --test "prisma/__tests__/phase10-proof-sql.test.ts"

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// process.cwd(), matching every sibling test in this directory — `test:migrations` runs from
// `frontend/`, and `import.meta.dirname` is undefined under this tsx/node configuration.
const APP_ROOT = process.cwd();
const REPO_ROOT = join(APP_ROOT, "..");
const MIGRATIONS_DIR = join(APP_ROOT, "prisma", "migrations");
const PROOF_DIR = join(REPO_ROOT, "docs", "transaction-flow", "phase-10-proof");

const PROOF_FILES = ["preflight.sql", "verify.sql"] as const;

/** The migrations this phase is known to ship. Named so a regex that matched some OTHER
 *  directory could not satisfy the anti-vacuity floor below on its own. */
const KNOWN = "20261215000000_phase10_cancellation_vocabulary";
const KNOWN_SECOND = "20261215000100_phase10_obligation_unique";

/** Every Phase 10 migration directory, from disk. 8-digit date + 6-digit time = the 14-digit stamp. */
function phase10MigrationsOnDisk(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((d) => /^20261215\d{6}_phase10_/.test(d))
    .sort();
}

/** Every migration name this SQL file mentions, deduplicated. */
function migrationsNamedIn(file: string): string[] {
  const sql = readFileSync(join(PROOF_DIR, file), "utf8");
  return [...new Set([...sql.matchAll(/'(20261215\d{6}_phase10_[a-z0-9_]+)'/g)].map((m) => m[1]!))].sort();
}

describe("phase 10 proof SQL names every phase 10 migration", () => {
  test("the migrations exist on disk at all — the fixture is not empty", () => {
    const found = phase10MigrationsOnDisk();
    // Guards THIS test against the very defect it exists to catch: a regex that matches nothing
    // would make every assertion below vacuously true. See the header — phase 8's first draft
    // did exactly that and only this assertion caught it.
    assert.ok(found.length >= 2, `expected at least 2 phase 10 migrations, found ${found.length}`);
    for (const known of [KNOWN, KNOWN_SECOND]) {
      assert.ok(
        found.includes(known),
        `the known phase 10 migration ${known} is not in ${JSON.stringify(found)} — the prefix ` +
          `pattern matches the wrong set, which is how a drift guard silently guards nothing`,
      );
    }
  });

  for (const file of PROOF_FILES) {
    test(`${file} names every phase 10 migration on disk`, () => {
      const onDisk = phase10MigrationsOnDisk();
      const named = migrationsNamedIn(file);
      // Anti-vacuity on the OTHER side of the comparison: an empty `named` with an empty
      // `onDisk` is the nothing-to-nothing pass. `onDisk` is already floored above; this floors
      // the file side, so neither set can be empty while the comparison reports success.
      assert.ok(named.length >= 1, `${file} names no phase 10 migration at all — the scan is broken, not the file`);
      const missing = onDisk.filter((m) => !named.includes(m));
      assert.deepEqual(
        missing,
        [],
        `${file} does not name ${missing.join(", ")}. A proof file that omits a migration ` +
          `reports a clean deploy with that migration missing — add it to the phase10_expected list.`,
      );
    });

    test(`${file} names no migration that does not exist`, () => {
      const onDisk = phase10MigrationsOnDisk();
      const phantom = migrationsNamedIn(file).filter((m) => !onDisk.includes(m));
      assert.deepEqual(
        phantom,
        [],
        `${file} names ${phantom.join(", ")}, which is not a directory under prisma/migrations. ` +
          `A proof asserting a migration that cannot apply fails every run for the wrong reason.`,
      );
    });

    test(`${file} states no hardcoded count of phase 10 migrations`, () => {
      // Phase 8's file said "two applied rows, one per migration" beside a two-name list and
      // both went stale together. The count is derived from the list in SQL; a literal TOTAL is
      // the shape that drifts, so it is refused.
      //
      // THE PLURAL IS THE WHOLE TEST, and the first draft of this guard got it wrong. "one
      // applied row PER phase 10 migration" is the per-migration idiom: it stays true at one
      // migration and at five, and the total beside it is derived from the CTE. Matching it
      // flagged three correct lines in verify.sql — a guard firing on the shape it exists to
      // permit. Only a plural total ("two applied rows") is a claim about how many migrations
      // the phase has, which is the claim that goes stale when a migration is added late.
      const sql = readFileSync(join(PROOF_DIR, file), "utf8");
      const literals = [...sql.matchAll(/\b(two|three|four|five|\d+)\s+applied\s+rows\b/gi)].map((m) => m[0]);
      assert.deepEqual(
        literals,
        [],
        `${file} hardcodes a migration count (${literals.join(", ")}). Derive it from the ` +
          `phase10_expected list instead — a literal beside a list is how phase 8's file drifted.`,
      );
    });
  }

  test("the proof files are all present", () => {
    for (const f of PROOF_FILES) {
      assert.ok(existsSync(join(PROOF_DIR, f)), `${f} is part of the phase 10 proof package and must exist`);
    }
  });

  test("every phase 10 migration directory carries a rollback.sql", () => {
    // THE GAP THIS PHASE ACTUALLY HAD. Both directories shipped with migration.sql alone. The
    // rollback for the enum half is a documented refusal rather than DDL — PostgreSQL cannot drop
    // an enum label — and a file saying so IS the artefact: an operator reaching for a rollback
    // needs to find that sentence, not an empty directory that leaves them guessing.
    const onDisk = phase10MigrationsOnDisk();
    assert.ok(onDisk.length >= 2, "the migration scan is broken, not the directories");
    const missing = onDisk.filter((d) => !existsSync(join(MIGRATIONS_DIR, d, "rollback.sql")));
    assert.deepEqual(
      missing,
      [],
      `${missing.join(", ")} has no rollback.sql. Eighteen directories in this chain carry one; ` +
        `where no reverse is possible the file records THAT, which is the artefact an operator needs.`,
    );
  });

  test("the proof-run log is present and records an exercise that actually ran", () => {
    // A log naming neither direction is a log of nothing. Both the pre-state pass and the
    // post-state pass are what make the package evidence rather than documentation.
    const log = join(PROOF_DIR, "proof-run.log");
    assert.ok(existsSync(log), "proof-run.log is part of the phase 10 proof package and must exist");
    const text = readFileSync(log, "utf8");
    for (const marker of ["PRE-deploy state", "POST-deploy state", "BLOCK", "MISSING"]) {
      assert.ok(
        text.includes(marker),
        `proof-run.log does not mention ${marker} — it must record the files failing as well as passing`,
      );
    }
  });

  // ── the terminal rows must state the number of rows their files really emit ──────────────
  //
  // WHY. The terminal row is what makes "this file produced no output" distinguishable from
  // "this file passed" — it is the anti-vacuity assertion of the SQL itself. Phase 8's numbers
  // were typed by hand and went stale twice. So they are COMPUTED here instead: one row per
  // assertion, N per VALUES list, one per name in the phase10_expected CTE.

  /** The file with every full-line `--` comment removed. Comments carry apostrophes, and an
   *  apostrophe in a comment desynchronises any quote-state scan of the SQL below it. */
  function withoutComments(sql: string): string {
    return sql.split("\n").filter((l) => !/^\s*(--|\\pset)/.test(l)).join("\n");
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
    if (/FROM phase10_expected\s+AS\s+\w+/.test(stmt)) {
      return (stmt.match(/\('20261215\d{6}_phase10_/g) ?? []).length;
    }
    return 1;
  }

  test("verify.sql's terminal row states the number of rows the file actually emits", () => {
    const sql = readFileSync(join(PROOF_DIR, "verify.sql"), "utf8");
    const stmts = statements(sql);

    // ANTI-VACUITY. A parser that finds no statements makes every count below 0 === 0, green
    // forever, guarding nothing. This assertion fired twice on two different broken scans while
    // phase 8's equivalent was being written (§8.1h #7).
    assert.ok(stmts.length >= 10, `parsed only ${stmts.length} statements from verify.sql — the parser is broken, not the file`);

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
        `the file emits ${total} rows (${physical} physical, ${ledger} ledger, 1 terminal).`,
    );
  });

  test("preflight.sql's terminal row states the number of rows the file actually emits", () => {
    const sql = readFileSync(join(PROOF_DIR, "preflight.sql"), "utf8");
    const stmts = statements(sql);

    assert.ok(stmts.length >= 10, `parsed only ${stmts.length} statements from preflight.sql — the parser is broken, not the file`);

    // A statement is block-capable when it can emit the verdict 'BLOCK'. Classifying on the
    // emitted literal rather than on a comment banner means a reworded heading cannot silently
    // downgrade an assertion that still stops the run.
    let blockCapable = 0;
    let reported = 0;
    let terminal = 0;
    for (const stmt of stmts) {
      const rows = rowsEmitted(stmt);
      if (stmt.includes("preflight complete")) terminal += rows;
      else if (stmt.includes("'BLOCK'")) blockCapable += rows;
      else reported += rows;
    }

    assert.ok(blockCapable > 0, "counted zero block-capable assertions — a preflight that cannot stop a run is not a preflight");
    assert.ok(reported > 0, "counted zero reported assertions — the parser is broken");
    assert.equal(terminal, 1, `expected exactly one terminal row, counted ${terminal}`);

    const stated = sql.match(/'(\d+) assertions: (\d+) block-capable, (\d+) reported'/);
    assert.ok(stated, "preflight.sql's terminal row no longer states 'N assertions: B block-capable, R reported'");

    const total = blockCapable + reported + terminal;
    assert.deepEqual(
      { total: Number(stated[1]), blockCapable: Number(stated[2]), reported: Number(stated[3]) },
      { total, blockCapable, reported },
      `preflight.sql's terminal row claims ${stated[1]} assertions (${stated[2]} block-capable, ${stated[3]} reported) ` +
        `but the file emits ${total} rows (${blockCapable} block-capable, ${reported} reported, 1 terminal).`,
    );
  });
});
