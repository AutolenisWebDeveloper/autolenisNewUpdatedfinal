// inventory_sources market config + call budget — schema ↔ migration ↔ rollback correspondence.
//
// The migration is WRITTEN BUT NOT APPLIED: it ships for owner review alongside the rest of
// the unapplied chain. Nothing executes it in CI's unit lane, so these assertions are the
// only thing holding the three artifacts together.
//
// A name divergence here is not cosmetic. Prisma selects every column a model declares, so a
// model field mapped to a column the chain never creates makes EVERY unnarrowed query on
// inventory_sources fail with P2022 — including the accounting write inside runInventorySync,
// which sits behind a `.catch(() => {})` and would swallow it silently.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "prisma");
const DIR = join(ROOT, "migrations", "20261104000000_inventory_market_config_and_call_budget");

const SCHEMA = readFileSync(join(ROOT, "schema.prisma"), "utf8");
const MIGRATION = readFileSync(join(DIR, "migration.sql"), "utf8");
const ROLLBACK = readFileSync(join(DIR, "rollback.sql"), "utf8");

/**
 * Executable SQL only. Safety assertions must run against this rather than the raw file:
 * the header explains WHY the migration drops nothing and carries no CHECK constraint, and a
 * naive text match would fail on the explanation — pressuring the author to delete the
 * reasoning instead of keeping the guarantee.
 */
const MIGRATION_SQL = MIGRATION.split("\n").map((l) => l.split("--")[0]).join("\n").trim();
const ROLLBACK_SQL = ROLLBACK.split("\n").map((l) => l.split("--")[0]).join("\n").trim();

function model(name: string): string {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(m, `schema.prisma has no model ${name}`);
  return m![1]!;
}

/** field name -> [Prisma type regex fragment, snake_case column, SQL type] */
const COLUMNS: Array<[string, string, string, string]> = [
  ["centerZip", "String\\?", "center_zip", "TEXT"],
  ["radiusMiles", "Int\\?", "radius_miles", "INTEGER"],
  ["filterMake", "String\\?", "filter_make", "TEXT"],
  ["filterModel", "String\\?", "filter_model", "TEXT"],
  ["filterYearMin", "Int\\?", "filter_year_min", "INTEGER"],
  ["filterYearMax", "Int\\?", "filter_year_max", "INTEGER"],
  ["filterPriceMaxCents", "Int\\?", "filter_price_max_cents", "INTEGER"],
  ["rowsPerCall", "Int", "rows_per_call", "INTEGER NOT NULL DEFAULT 50"],
  ["maxCallsPerRun", "Int", "max_calls_per_run", "INTEGER NOT NULL DEFAULT 10"],
  ["monthlyCallBudget", "Int\\?", "monthly_call_budget", "INTEGER"],
  ["callsUsedThisCycle", "Int", "calls_used_this_cycle", "INTEGER NOT NULL DEFAULT 0"],
  ["budgetCycleKey", "String\\?", "budget_cycle_key", "TEXT"],
];

describe("InventorySource market config + call budget", () => {
  test("the model declares all twelve fields with the exact type and @map", () => {
    const body = model("InventorySource");
    for (const [field, type, column] of COLUMNS) {
      assert.match(
        body,
        new RegExp(`${field}\\s+${type}\\s+(@default\\([^)]*\\)\\s+)?@map\\("${column}"\\)`),
        `${field} must be declared ${type.replace("\\", "")} and mapped to ${column}`,
      );
    }
  });

  test("money is integer minor units", () => {
    const body = model("InventorySource");
    assert.match(body, /filterPriceMaxCents\s+Int\?/,
      "a price filter must be integer cents, never a float or a dollar amount");
    assert.equal(/filterPriceMax\s+(Float|Decimal)/.test(body), false);
  });

  test("the migration creates exactly those twelve columns, additively and idempotently", () => {
    for (const [, , column, sqlType] of COLUMNS) {
      assert.match(
        MIGRATION_SQL,
        new RegExp(`ALTER TABLE "inventory_sources" ADD COLUMN IF NOT EXISTS "${column}" ${sqlType};`),
        `missing or mismatched ADD COLUMN for ${column}`,
      );
    }
    const statements = MIGRATION_SQL.split(";").filter((s) => s.trim().length > 0);
    assert.equal(statements.length, COLUMNS.length + 2,
      "12 ADD COLUMN + 1 ALTER TYPE + 1 config UPDATE; anything else belongs in its own migration");
  });

  test("the BUDGET_EXHAUSTED label is added and never referenced later in the same file", () => {
    assert.match(SCHEMA, /enum SyncRunStatus \{[\s\S]*?BUDGET_EXHAUSTED[\s\S]*?\}/);
    assert.match(MIGRATION_SQL, /ALTER TYPE "SyncRunStatus" ADD VALUE IF NOT EXISTS 'BUDGET_EXHAUSTED';/);

    // PostgreSQL forbids USING a new enum label in the same transaction that adds it.
    // Prisma wraps a migration in one transaction, so a later statement referencing the
    // label would fail at apply time — long after this test would have passed.
    const after = MIGRATION_SQL.split(/ALTER TYPE "SyncRunStatus" ADD VALUE[^;]*;/)[1] ?? "";
    assert.equal(after.includes("BUDGET_EXHAUSTED"), false,
      "no statement after the ADD VALUE may reference the new label");
  });

  test("the DFW repoint is an UPDATE, not a guarded INSERT", () => {
    // Production holds exactly one inventory_sources row already (MARKETCHECK/"MarketCheck",
    // created at runtime by ensureInventorySource). A `WHERE NOT EXISTS` INSERT would match
    // nothing there and the repoint would silently never happen.
    assert.match(MIGRATION_SQL, /UPDATE "inventory_sources"/);
    assert.equal(/INSERT\s+INTO\s+"inventory_sources"/i.test(MIGRATION_SQL), false,
      "an INSERT would be a no-op against the existing production row");
    assert.match(MIGRATION_SQL, /"center_zip"\s*=\s*'76011'/, "DFW centroid (Arlington TX)");
    assert.match(MIGRATION_SQL, /"radius_miles"\s*=\s*100/, "provider ceiling");
    assert.match(MIGRATION_SQL, /"monthly_call_budget"\s*=\s*400/, "310 scheduled + headroom under a 500 cap");
    assert.match(MIGRATION_SQL, /"center_zip"\s+IS\s+NULL/,
      "the guard is what stops a later owner edit being overwritten on re-apply");
  });

  test("the radius ceiling is NOT enforced by a CHECK constraint", () => {
    // Deliberate. This chain contains zero CHECK constraints in 101 migrations, Prisma
    // cannot model them, and check-migration-drift.ts fails in both directions once
    // structural statements move off the recorded baseline. The ceiling is enforced in code
    // twice instead — clampRadius() and buildApiUrl()'s own Math.min — and pinned by test.
    assert.equal(/CHECK\s*\(/i.test(MIGRATION_SQL), false);
  });

  test("the migration drops nothing and touches no RLS policy", () => {
    // inventory_sources runs RLS-enabled with ZERO policies in production (verified
    // read-only 2026-09-02). Adding a policy to such a table OPENS access.
    assert.equal(/DROP\s+(TABLE|COLUMN)/i.test(MIGRATION_SQL), false);
    assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(MIGRATION_SQL), false);
    assert.equal(/ROW LEVEL SECURITY/i.test(MIGRATION_SQL), false);
    assert.equal(/CREATE TABLE/i.test(MIGRATION_SQL), false);
  });

  test("the rollback reverses exactly these twelve columns and nothing else", () => {
    for (const [, , column] of COLUMNS) {
      assert.match(
        ROLLBACK_SQL,
        new RegExp(`ALTER TABLE "inventory_sources" DROP COLUMN IF EXISTS "${column}";`),
        `rollback is missing ${column}`,
      );
    }
    assert.equal(
      ROLLBACK_SQL.split(";").filter((s) => s.trim().length > 0).length,
      COLUMNS.length,
      "a rollback that does more than reverse its own migration is not a rollback",
    );
    // PostgreSQL has no DROP VALUE; rebuilding the type would rewrite inventory_sync_runs.
    assert.equal(/DROP\s+VALUE/i.test(ROLLBACK_SQL), false);
    assert.match(ROLLBACK, /BUDGET_EXHAUSTED is deliberately NOT dropped/,
      "the rollback must document the enum label it cannot remove");
  });

  test("no inventory_items row is rewritten by this migration", () => {
    // The 95 mislabeled LANE_1 rows are corrected by the stale sweep at runtime, under a
    // dry-run default and a blast-radius breaker — never by a blind UPDATE in a migration.
    assert.equal(MIGRATION_SQL.includes("inventory_items"), false);
  });
});
