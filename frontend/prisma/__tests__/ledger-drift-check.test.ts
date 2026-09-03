// Ledger drift gate — the checker's own tests.
//
// The incident these encode: on 2026-09-03 six migrations were physically present in
// production while `_prisma_migrations` held no row for any of them. `prisma migrate
// status` reads the ledger, so it reported them pending; the physical schema said
// otherwise. A P2022 exposure was reported against routes that were never at risk.
//
// The checker's whole value is telling APPLIED_NOT_RECORDED apart from PENDING, so
// that distinction is what these tests hold. A parser that silently misses an object
// would turn drift into PARTIAL or PENDING and let the exact failure through again,
// which is why extraction is asserted against the real migration files rather than
// against fixtures written to match the parser.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  classify,
  extractObjects,
  isDrift,
  migrationDirsOnDisk,
  objectExists,
  stripComments,
  type DbObject,
  type SchemaInventory,
} from "../../scripts/check-ledger-drift";

const MIGRATIONS = join(process.cwd(), "prisma", "migrations");
const sqlOf = (dir: string) => readFileSync(join(MIGRATIONS, dir, "migration.sql"), "utf8");

const has = (objects: DbObject[], kind: string, name: string, parent?: string) =>
  objects.some((o) => o.kind === kind && o.name === name && o.parent === parent);

/** An inventory in which every one of `objects` exists and nothing else does. */
function inventoryOf(objects: DbObject[]): SchemaInventory {
  const inv: SchemaInventory = {
    tables: new Set(),
    columns: new Set(),
    indexes: new Set(),
    constraints: new Set(),
    types: new Set(),
    enumValues: new Set(),
  };
  for (const o of objects) {
    if (o.kind === "table") inv.tables.add(o.name);
    if (o.kind === "column") inv.columns.add(`${o.parent}.${o.name}`);
    if (o.kind === "index") inv.indexes.add(o.name);
    if (o.kind === "constraint") inv.constraints.add(o.name);
    if (o.kind === "type") inv.types.add(o.name);
    if (o.kind === "enumValue") inv.enumValues.add(`${o.parent}.${o.name}`);
  }
  return inv;
}

describe("extractObjects — the real migration files", () => {
  test("20261105 dealer provenance: 7 columns, 1 defaulted integer, 1 index, 1 FK", () => {
    const o = extractObjects(sqlOf("20261105000000_inventory_dealer_provenance_and_call_accounting"));

    for (const c of [
      "external_dealer_street",
      "external_dealer_zip",
      "external_dealer_email",
      "external_dealer_type",
      "mc_rooftop_id",
      "mc_dealer_id",
      "rooftop_id",
    ]) {
      assert.ok(has(o, "column", c, "inventory_items"), `missing inventory_items.${c}`);
    }

    assert.ok(has(o, "column", "api_calls_used", "inventory_sync_runs"));
    assert.ok(has(o, "index", "inventory_items_rooftop_id_idx"));
    // The FK is added inside a `DO $$ ... $$` guard — the parser must see through it.
    assert.ok(has(o, "constraint", "inventory_items_rooftop_id_fkey"));
  });

  test("20261104 market config: 12 columns and the appended enum label", () => {
    const o = extractObjects(sqlOf("20261104000000_inventory_market_config_and_call_budget"));

    for (const c of [
      "center_zip",
      "radius_miles",
      "filter_make",
      "filter_model",
      "filter_year_min",
      "filter_year_max",
      "filter_price_max_cents",
      "rows_per_call",
      "max_calls_per_run",
      "monthly_call_budget",
      "calls_used_this_cycle",
      "budget_cycle_key",
    ]) {
      assert.ok(has(o, "column", c, "inventory_sources"), `missing inventory_sources.${c}`);
    }

    assert.ok(has(o, "enumValue", "BUDGET_EXHAUSTED", "SyncRunStatus"));
  });

  test("a multi-clause ALTER TABLE attributes every column to the right table", () => {
    // 20261015 alters two tables, each with several ADD COLUMN clauses on their own
    // lines. A parser that forgot the owning table would file them under the wrong one.
    const o = extractObjects(sqlOf("20261015000000_esign_consent_and_executed_artifact"));

    assert.ok(has(o, "column", "confirmations_sent_at", "e_sign_envelopes"));
    assert.ok(has(o, "column", "consent_snapshot", "e_sign_envelopes"));
    assert.ok(has(o, "column", "consent_snapshot", "e_sign_envelope_history"));
    // `confirmations_sent_at` is added to e_sign_envelopes ONLY.
    assert.ok(!has(o, "column", "confirmations_sent_at", "e_sign_envelope_history"));
  });

  test("CREATE TABLE and CREATE TYPE are extracted", () => {
    const o = extractObjects(sqlOf("20261016000000_ai_action_intent_lifecycle"));
    assert.ok(has(o, "table", "ai_action_intents"));
    assert.ok(has(o, "type", "AiActionIntentStatus"));
    assert.ok(has(o, "index", "ai_action_intents_idempotency_key_key"));
  });

  test("every migration directory on disk parses without throwing", () => {
    const dirs = migrationDirsOnDisk();
    assert.ok(dirs.length > 100, `expected the full chain, got ${dirs.length}`);
    for (const d of dirs) assert.doesNotThrow(() => extractObjects(sqlOf(d)), d);
  });
});

describe("stripComments", () => {
  test("a commented statement yields no object", () => {
    const o = extractObjects(`-- CREATE TABLE "ghost" (id TEXT);\n-- ALTER TYPE "T" ADD VALUE 'X'`);
    assert.deepEqual(o, []);
  });

  test("an inline comment does not swallow the statement before it", () => {
    const sql = `ALTER TABLE "t" ADD COLUMN IF NOT EXISTS "c" TEXT; -- why`;
    assert.ok(has(extractObjects(sql), "column", "c", "t"));
    assert.ok(!stripComments(sql).includes("why"));
  });
});

describe("classify", () => {
  const objects: DbObject[] = [
    { kind: "column", parent: "t", name: "a" },
    { kind: "column", parent: "t", name: "b" },
    { kind: "index", name: "t_a_idx" },
  ];

  test("every object present, no ledger row -> APPLIED_NOT_RECORDED, and that is drift", () => {
    const c = classify(objects, () => true);
    assert.equal(c.verdict, "APPLIED_NOT_RECORDED");
    assert.equal(c.absent.length, 0);
    assert.ok(isDrift(c.verdict));
  });

  test("no object present -> PENDING, and that is NOT drift", () => {
    const c = classify(objects, () => false);
    assert.equal(c.verdict, "PENDING");
    // A written-but-unapplied migration is a normal pre-deploy state. If this ever
    // becomes a failure the gate blocks every migration shipped for owner review.
    assert.ok(!isDrift(c.verdict));
  });

  test("some present -> PARTIAL, and that is drift", () => {
    const c = classify(objects, (o) => o.name === "a");
    assert.equal(c.verdict, "PARTIAL");
    assert.equal(c.present.length, 1);
    assert.equal(c.absent.length, 2);
    assert.ok(isDrift(c.verdict));
  });

  test("nothing checkable -> UNVERIFIABLE, never a silent pass as applied", () => {
    // A data-only migration, or one whose statements the parser does not cover, must
    // not be judged. Reporting it is honest; calling it APPLIED_NOT_RECORDED is not.
    const c = classify([], () => true);
    assert.equal(c.verdict, "UNVERIFIABLE");
    assert.ok(!isDrift(c.verdict));
  });
});

describe("objectExists", () => {
  test("matches on the qualified key, not the bare name", () => {
    const inv = inventoryOf([{ kind: "column", parent: "inventory_items", name: "rooftop_id" }]);
    assert.ok(objectExists(inv, { kind: "column", parent: "inventory_items", name: "rooftop_id" }));
    // Same column name on a different table must not count as present.
    assert.ok(!objectExists(inv, { kind: "column", parent: "dealers", name: "rooftop_id" }));
  });

  test("an enum label is scoped to its type", () => {
    const inv = inventoryOf([{ kind: "enumValue", parent: "SyncRunStatus", name: "BUDGET_EXHAUSTED" }]);
    assert.ok(objectExists(inv, { kind: "enumValue", parent: "SyncRunStatus", name: "BUDGET_EXHAUSTED" }));
    assert.ok(!objectExists(inv, { kind: "enumValue", parent: "DealStatus", name: "BUDGET_EXHAUSTED" }));
  });
});

describe("the 2026-09-03 incident, reconstructed", () => {
  // The six migrations that were physically applied to production while
  // `_prisma_migrations` held no row for any of them.
  const UNRECORDED = [
    "20261014000000_esign_envelope_history",
    "20261015000000_esign_consent_and_executed_artifact",
    "20261016000000_ai_action_intent_lifecycle",
    "20261016000000_contract_scan_version_link",
    "20261104000000_inventory_market_config_and_call_budget",
    "20261105000000_inventory_dealer_provenance_and_call_accounting",
  ];

  test("all six are detected as APPLIED_NOT_RECORDED against a database that has their objects", () => {
    for (const dir of UNRECORDED) {
      const objects = extractObjects(sqlOf(dir));
      assert.ok(objects.length > 0, `${dir} extracted nothing — it would be UNVERIFIABLE, not drift`);

      const inv = inventoryOf(objects);
      const c = classify(objects, (o) => objectExists(inv, o));

      assert.equal(c.verdict, "APPLIED_NOT_RECORDED", dir);
      assert.ok(isDrift(c.verdict), dir);
    }
  });

  test("the same six read as PENDING against a database that does not have them", () => {
    // The other half of the distinction: before they were applied, this exact input
    // had to come back clean. A checker that failed here would cry drift on every
    // migration shipped for review.
    const empty = inventoryOf([]);
    for (const dir of UNRECORDED) {
      const objects = extractObjects(sqlOf(dir));
      const c = classify(objects, (o) => objectExists(empty, o));
      assert.equal(c.verdict, "PENDING", dir);
      assert.ok(!isDrift(c.verdict), dir);
    }
  });
});
