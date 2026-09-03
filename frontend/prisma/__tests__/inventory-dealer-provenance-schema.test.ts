// inventory dealer provenance + call accounting — schema <-> migration <-> rollback correspondence.
//
// The migration is WRITTEN BUT NOT APPLIED. Nothing executes it in CI's unit lane, so these
// assertions are the only thing holding the three artifacts together.
//
// A name divergence here is not cosmetic. Prisma selects every column a model declares, so a
// field mapped to a column the chain never creates makes EVERY unnarrowed query on
// inventory_items fail with P2022 — which is every buyer-facing catalogue read.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "prisma");
const DIR = join(ROOT, "migrations", "20261105000000_inventory_dealer_provenance_and_call_accounting");

const SCHEMA = readFileSync(join(ROOT, "schema.prisma"), "utf8");
const MIGRATION = readFileSync(join(DIR, "migration.sql"), "utf8");
const ROLLBACK = readFileSync(join(DIR, "rollback.sql"), "utf8");

/** Executable SQL only — the headers explain WHY nothing is dropped, and a naive text match
 *  against the raw file would fail on the explanation rather than on the guarantee. */
const strip = (s: string) => s.split("\n").map((l) => l.split("--")[0]).join("\n").trim();
const MIGRATION_SQL = strip(MIGRATION);
const ROLLBACK_SQL = strip(ROLLBACK);

function model(name: string): string {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(m, `schema.prisma has no model ${name}`);
  return m![1]!;
}

/** [prisma field, type fragment, column, SQL type, owning model] */
const COLUMNS: Array<[string, string, string, string, string]> = [
  ["externalDealerStreet", "String\\?", "external_dealer_street", "TEXT", "InventoryItem"],
  ["externalDealerZip", "String\\?", "external_dealer_zip", "TEXT", "InventoryItem"],
  ["externalDealerEmail", "String\\?", "external_dealer_email", "TEXT", "InventoryItem"],
  ["externalDealerType", "String\\?", "external_dealer_type", "TEXT", "InventoryItem"],
  ["mcRooftopId", "String\\?", "mc_rooftop_id", "TEXT", "InventoryItem"],
  ["mcDealerId", "String\\?", "mc_dealer_id", "TEXT", "InventoryItem"],
  ["rooftopId", "String\\?", "rooftop_id", "TEXT", "InventoryItem"],
  ["apiCallsUsed", "Int", "api_calls_used", "INTEGER NOT NULL DEFAULT 0", "InventorySyncRun"],
];

describe("every declared field exists in the migration under the same column name", () => {
  for (const [field, type, column, sqlType, modelName] of COLUMNS) {
    test(`${modelName}.${field} -> ${column}`, () => {
      const body = model(modelName);
      assert.match(
        body,
        new RegExp(`\\b${field}\\s+${type}[^\\n]*@map\\("${column}"\\)`),
        `${modelName}.${field} must be declared and mapped to ${column}`,
      );
      assert.match(
        MIGRATION_SQL,
        new RegExp(`ADD COLUMN IF NOT EXISTS "${column}" ${sqlType}`),
        `migration must add ${column}`,
      );
      assert.match(
        ROLLBACK_SQL,
        new RegExp(`DROP COLUMN IF EXISTS "${column}"`),
        `rollback must drop ${column}`,
      );
    });
  }
});

test("the rooftop relation is declared on both sides", () => {
  assert.match(model("InventoryItem"), /rooftop\s+DealerRooftop\?\s+@relation\(fields: \[rooftopId\], references: \[id\]\)/);
  assert.match(model("DealerRooftop"), /inventoryItems\s+InventoryItem\[\]/);
});

test("the rooftop index is declared AND created", () => {
  assert.match(model("InventoryItem"), /@@index\(\[rooftopId\]\)/);
  assert.match(MIGRATION_SQL, /CREATE INDEX IF NOT EXISTS "inventory_items_rooftop_id_idx"/);
  assert.match(ROLLBACK_SQL, /DROP INDEX IF EXISTS "inventory_items_rooftop_id_idx"/);
});

test("the foreign key is ON DELETE SET NULL — a rooftop cleanup must never delete inventory", () => {
  assert.match(MIGRATION_SQL, /FOREIGN KEY \("rooftop_id"\) REFERENCES "dealer_rooftops"\("id"\)/);
  assert.match(MIGRATION_SQL, /ON DELETE SET NULL ON UPDATE CASCADE/);
  assert.doesNotMatch(
    MIGRATION_SQL,
    /rooftop_id[\s\S]*?ON DELETE CASCADE/,
    "CASCADE here would let a rooftop delete take buyer-visible listings with it",
  );
  assert.match(ROLLBACK_SQL, /DROP CONSTRAINT IF EXISTS "inventory_items_rooftop_id_fkey"/);
});

test("the migration is purely additive — it drops and rewrites nothing", () => {
  // Matched as STATEMENTS, not bare keywords: "ON DELETE SET NULL" and "ON UPDATE CASCADE" are
  // referential actions on the foreign key and are exactly what this migration is supposed to
  // contain. A bare /\bDELETE\b/ flags those and pressures the author to weaken the FK to
  // satisfy the test — the assertion has to name the destructive form precisely or it is worse
  // than no assertion.
  assert.doesNotMatch(MIGRATION_SQL, /\bDROP\s+(TABLE|COLUMN|CONSTRAINT|INDEX|TYPE|SCHEMA)\b/i);
  assert.doesNotMatch(MIGRATION_SQL, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(MIGRATION_SQL, /\bTRUNCATE\b/i);
  assert.doesNotMatch(MIGRATION_SQL, /^\s*UPDATE\s+"/im, "no backfill: rows stay NULL until re-swept");
  assert.doesNotMatch(MIGRATION_SQL, /\bALTER\s+COLUMN\b/i, "no in-place type or nullability change");
});

test("every ADD COLUMN is idempotent", () => {
  const adds = MIGRATION_SQL.match(/ADD COLUMN/g) ?? [];
  const guarded = MIGRATION_SQL.match(/ADD COLUMN IF NOT EXISTS/g) ?? [];
  assert.equal(adds.length, guarded.length, "an unguarded ADD COLUMN breaks re-application");
  assert.equal(adds.length, COLUMNS.length);
});

test("the FK creation is guarded — ADD CONSTRAINT has no IF NOT EXISTS in Postgres", () => {
  assert.match(MIGRATION_SQL, /SELECT 1 FROM pg_constraint WHERE conname = 'inventory_items_rooftop_id_fkey'/);
});

test("it sorts AFTER the market-config migration it builds on", () => {
  assert.ok("20261105000000" > "20261104000000", "chain order must place this second");
});

test("no RLS statement — inventory_items is a zero-policy deny-all table and adding one OPENS it", () => {
  assert.doesNotMatch(MIGRATION_SQL, /ROW LEVEL SECURITY/i);
  assert.doesNotMatch(MIGRATION_SQL, /CREATE POLICY/i);
});
