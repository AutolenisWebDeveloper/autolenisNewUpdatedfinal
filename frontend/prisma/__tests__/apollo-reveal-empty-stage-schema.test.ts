// apollo_reveals.empty_stage — schema ↔ migration ↔ rollback correspondence.
//
// The migration is WRITTEN BUT NOT APPLIED: it ships for owner review alongside
// the rest of the unapplied chain. Nothing executes it in CI's unit lane, so
// these assertions are the only thing holding the three artifacts together —
// schema.prisma declares the column AND migration.sql creates it under the same
// name AND rollback.sql removes exactly that one.
//
// A name divergence here is not cosmetic. Prisma selects every column a model
// declares, so a model field mapped to a column the chain never creates makes
// EVERY query on apollo_reveals fail with P2022 — the reveal-cache read
// included, not just the write that uses the new field.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "prisma");
const DIR = join(ROOT, "migrations", "20261103000000_apollo_reveal_empty_stage");

const SCHEMA = readFileSync(join(ROOT, "schema.prisma"), "utf8");
const MIGRATION = readFileSync(join(DIR, "migration.sql"), "utf8");
const ROLLBACK = readFileSync(join(DIR, "rollback.sql"), "utf8");

/**
 * Executable SQL only. Safety assertions must run against this rather than the
 * raw file: the header explains WHY the migration drops nothing, and a naive
 * text match on "DROP" would fail on the explanation — pressuring the author to
 * delete the reasoning instead of keeping the guarantee.
 */
const MIGRATION_SQL = MIGRATION.split("\n").map((l) => l.split("--")[0]).join("\n").trim();

/** The body of `model <name> { ... }` from schema.prisma. */
function model(name: string): string {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(m, `schema.prisma has no model ${name}`);
  return m[1];
}

describe("ApolloReveal.emptyStage", () => {
  test("the model declares it nullable and mapped to empty_stage", () => {
    const body = model("ApolloReveal");
    assert.match(
      body,
      /emptyStage\s+String\?\s+@map\("empty_stage"\)/,
      "emptyStage must be an OPTIONAL String mapped to empty_stage — EMPTY rows written " +
        "before this column existed have no stage, and inventing one would fabricate provenance",
    );
  });

  test("the migration creates exactly that column, additively and idempotently", () => {
    assert.match(MIGRATION_SQL, /ALTER TABLE "apollo_reveals" ADD COLUMN IF NOT EXISTS "empty_stage" TEXT;/);
    assert.equal(
      MIGRATION_SQL.split(";").filter((s) => s.trim().length > 0).length,
      1,
      "this migration is one statement; anything else belongs in its own migration",
    );
  });

  test("the migration drops nothing and touches no RLS policy", () => {
    // apollo_reveals runs RLS-enabled with ZERO policies (deny-all for
    // anon/authenticated, bypass for service_role). Adding a policy to such a
    // table OPENS access rather than hardening it.
    assert.equal(/DROP\s+(TABLE|COLUMN)/i.test(MIGRATION_SQL), false);
    assert.equal(/CREATE POLICY|ALTER POLICY|DROP POLICY/i.test(MIGRATION_SQL), false);
    assert.equal(/ROW LEVEL SECURITY/i.test(MIGRATION_SQL), false);
  });

  test("the rollback reverses exactly this column and nothing else", () => {
    const sql = ROLLBACK.split("\n").map((l) => l.split("--")[0]).join("\n").trim();
    assert.match(sql, /ALTER TABLE "apollo_reveals" DROP COLUMN IF EXISTS "empty_stage";/);
    assert.equal(
      sql.split(";").filter((s) => s.trim().length > 0).length,
      1,
      "a rollback that does more than reverse its own migration is not a rollback",
    );
  });

  test("no ledger or billing column is touched", () => {
    // The stage diagnoses; it must never reprice. credits_cost stays decided by
    // whether Apollo billed, and the ledger table is not in this migration.
    for (const forbidden of ["credits_cost", "apollo_credit_ledger", "cap_credits", "spent_credits"]) {
      assert.equal(
        MIGRATION_SQL.includes(forbidden),
        false,
        `${forbidden} must not appear in a diagnostic-only migration`,
      );
    }
  });
});
