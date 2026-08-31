// Task 1 — schema + migration for the operational dealer-outreach system.
//
// The migration is WRITTEN BUT NOT APPLIED: it ships for owner review alongside
// the rest of the unapplied chain. These assertions are therefore the only thing
// standing between the schema and the SQL, so they check both directions —
// schema.prisma declares it AND migration.sql creates it AND rollback.sql
// reverses it.
//
// Two invariants are load-bearing rather than stylistic:
//
//   RLS. dealer_outreach_log, dealer_rooftops, dealer_contact_profiles,
//   dealer_intelligence and dealer_invitations run with RLS ENABLED and ZERO
//   policies. That is deny-all for anon/authenticated and bypass for
//   service_role. Adding a policy to such a table OPENS access rather than
//   hardening it, so this migration must contain no CREATE POLICY at all.
//
//   Additive only. Production carries 1,532 dealer_prospects and 582 contact
//   profiles whose provenance columns are the subject of the wider change; a
//   DROP COLUMN here would destroy data the review is meant to evaluate.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(process.cwd(), "prisma");
const MIGRATION_DIR = join(ROOT, "migrations", "20261102000000_dealer_outreach_apollo_operational");

const SCHEMA = readFileSync(join(ROOT, "schema.prisma"), "utf8");
const MIGRATION = readFileSync(join(MIGRATION_DIR, "migration.sql"), "utf8");
const ROLLBACK = readFileSync(join(MIGRATION_DIR, "rollback.sql"), "utf8");

/**
 * The migration with `--` comments removed.
 *
 * Safety assertions MUST run against this, not the raw file. A comment
 * explaining why the migration contains no CREATE POLICY would otherwise fail a
 * naive text match on "CREATE POLICY" — a false positive that pressures the
 * author to delete the explanation rather than keep the guarantee. Only
 * executable SQL can create a policy or drop a column.
 */
const MIGRATION_SQL = MIGRATION.split("\n")
  .map((line) => line.split("--")[0])
  .join("\n");

/**
 * Statement-initial lines of executable SQL, excluding anything inside a
 * `DO $$ ... END $$` block. Those blocks carry their own guard (an EXCEPTION
 * handler), which is checked separately — `ADD CONSTRAINT` has no
 * `IF NOT EXISTS` form in postgres, so the block IS the idempotency mechanism.
 */
function guardableStatements(): string[] {
  const out: string[] = [];
  let inDoBlock = false;
  for (const raw of MIGRATION_SQL.split("\n")) {
    if (/^\s*DO \$\$/.test(raw)) inDoBlock = true;
    if (inDoBlock) {
      if (/END \$\$/.test(raw)) inDoBlock = false;
      continue;
    }
    if (/^\s*(ALTER TABLE|CREATE)/i.test(raw)) out.push(raw);
  }
  return out;
}

/** The body of `model <name> { ... }` from schema.prisma. */
function model(name: string): string {
  const m = SCHEMA.match(new RegExp(`^model ${name} \\{([\\s\\S]*?)^\\}`, "m"));
  assert.ok(m, `schema.prisma has no model ${name}`);
  return m[1];
}

describe("dealer_contact_profiles — the canonical personnel store", () => {
  const APOLLO_COLUMNS = [
    "apollo_person_id",
    "apollo_organization_id",
    "apollo_last_synced_at",
    "linkedin_url",
    "dnc_status",
    "dnc_checked_at",
    "phone_type",
    "is_primary_contact",
  ];

  test("carries Apollo identity, DNC provenance and phone type", () => {
    const body = model("DealerContactProfile");
    for (const col of APOLLO_COLUMNS) {
      assert.ok(body.includes(col), `DealerContactProfile is missing ${col}`);
      assert.ok(MIGRATION.includes(col), `migration.sql does not add ${col}`);
    }
  });

  test("apollo_person_id is UNIQUE — the idempotency key for credit spend", () => {
    // The spend guard keys on the PERSON, not the prospect: one Apollo person can
    // surface under two rooftops, and a per-prospect guard would reveal (and bill
    // for) that person twice. Uniqueness must be enforced by the database, not by
    // a read-then-write in application code.
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX[\s\S]{0,120}?dealer_contact_profiles[\s\S]{0,80}?apollo_person_id/i,
      "apollo_person_id must be UNIQUE so one Apollo person is never enriched twice",
    );
  });

  test("consent_basis exists, defaults to NONE, and is separate from phone_type", () => {
    const body = model("DealerContactProfile");
    for (const col of ["consent_basis", "consent_basis_set_at", "consent_basis_source"]) {
      assert.ok(body.includes(col), `DealerContactProfile is missing ${col}`);
      assert.ok(MIGRATION.includes(col), `migration.sql does not add ${col}`);
    }
    assert.match(
      MIGRATION,
      /"consent_basis"[^,;]*DEFAULT\s+'NONE'/i,
      "consent_basis must default to NONE so the phone channel fails closed",
    );
    // phone_type gates independently of DNC and of consent; collapsing them would
    // make it impossible to allow a corporate line while blocking a mobile.
    assert.ok(model("DealerContactProfile").includes("phone_type"));
  });
});

describe("dealer_outreach_log — one row per attempt, every channel", () => {
  test("gains SMS columns without losing the email columns", () => {
    const body = model("DealerOutreachLog");
    for (const col of ["to_phone", "from_phone", "twilio_sid"]) {
      assert.ok(body.includes(col), `DealerOutreachLog is missing ${col}`);
      assert.ok(MIGRATION.includes(col), `migration.sql does not add ${col}`);
    }
    for (const col of ["to_email", "from_email", "resend_id"]) {
      assert.ok(body.includes(col), `DealerOutreachLog lost ${col}`);
    }
  });

  test("gains call-channel columns — the Phase 3 shipping deliverable", () => {
    const body = model("DealerOutreachLog");
    for (const col of ["call_disposition", "call_duration_seconds", "consent_basis"]) {
      assert.ok(body.includes(col), `DealerOutreachLog is missing ${col}`);
      assert.ok(MIGRATION.includes(col), `migration.sql does not add ${col}`);
    }
  });

  test("a partial unique index closes the send race the application check cannot", () => {
    // sendDealerEmail's idempotency check is read-then-write: two concurrent sends
    // for the same (prospect, step) both pass findFirst and both dispatch. Only a
    // database constraint can close that. Partial on non-failed rows so a failed
    // attempt stays retriable.
    assert.match(
      MIGRATION,
      /CREATE UNIQUE INDEX[\s\S]{0,200}?dealer_outreach_log[\s\S]{0,200}?WHERE[\s\S]{0,80}?status/i,
      "a PARTIAL unique index on (prospect, step, channel) must guard concurrent sends",
    );
    for (const col of ["dealer_prospect_id", "outreach_sequence_step", "channel"]) {
      assert.match(
        MIGRATION,
        new RegExp(`CREATE UNIQUE INDEX[\\s\\S]{0,300}?${col}`, "i"),
        `the send-race index must include ${col}`,
      );
    }
  });
});

describe("new tables", () => {
  test("apollo_person_candidates holds 0-credit search results, unenriched", () => {
    const body = model("ApolloPersonCandidate");
    for (const col of [
      "apollo_person_id",
      "last_name_obfuscated",
      "match_method",
      "match_confidence",
      "enrichment_status",
      "reveal_request_id",
    ]) {
      assert.ok(body.includes(col), `ApolloPersonCandidate is missing ${col}`);
    }
    assert.ok(MIGRATION.includes("apollo_person_candidates"));
  });

  test("apollo_enrichment_runs makes credit spend auditable", () => {
    const body = model("ApolloEnrichmentRun");
    for (const col of ["max_credits", "credits_spent", "abort_reason", "waterfall_enabled"]) {
      assert.ok(body.includes(col), `ApolloEnrichmentRun is missing ${col}`);
    }
    assert.ok(MIGRATION.includes("apollo_enrichment_runs"));
  });

  test("both new tables are @@map'd, so the chain-vs-schema check can see them", () => {
    assert.match(SCHEMA, /@@map\("apollo_person_candidates"\)/);
    assert.match(SCHEMA, /@@map\("apollo_enrichment_runs"\)/);
  });
});

describe("migration safety", () => {
  test("adds no RLS policy — these tables are deny-all by having none", () => {
    assert.doesNotMatch(
      MIGRATION_SQL,
      /CREATE POLICY/i,
      "adding a policy to a zero-policy RLS table OPENS access rather than hardening it",
    );
    assert.doesNotMatch(
      MIGRATION_SQL,
      /ROW LEVEL SECURITY/i,
      "RLS state on these tables is not this migration's to change",
    );
  });

  test("is additive only — no column or table is dropped", () => {
    assert.doesNotMatch(MIGRATION_SQL, /DROP COLUMN/i);
    assert.doesNotMatch(MIGRATION_SQL, /DROP TABLE/i);
    assert.doesNotMatch(MIGRATION_SQL, /TRUNCATE/i);
    assert.doesNotMatch(MIGRATION_SQL, /\bDELETE\s+FROM\b/i);
  });

  test("is idempotent — safe to re-run against a database that already has it", () => {
    const statements = guardableStatements();
    assert.ok(statements.length > 0, "expected some DDL outside DO blocks");
    for (const stmt of statements) {
      assert.match(
        stmt,
        /IF NOT EXISTS/i,
        `every statement must be guarded so re-running is a no-op: ${stmt.trim()}`,
      );
    }
    // ADD CONSTRAINT has no IF NOT EXISTS form, so any DO block standing in for
    // one must actually swallow the duplicate — otherwise a re-run throws.
    for (const block of MIGRATION_SQL.match(/DO \$\$[\s\S]*?END \$\$/g) ?? []) {
      assert.match(
        block,
        /EXCEPTION[\s\S]*?duplicate_object/i,
        "a DO block substituting for IF NOT EXISTS must handle duplicate_object",
      );
    }
  });

  test("declares no postgres UUID column — ids are cuid TEXT here", () => {
    // Enforced repo-wide by migration-chain.test.ts; asserted locally so a
    // failure names this migration rather than the whole chain.
    for (const line of MIGRATION_SQL.split("\n")) {
      assert.doesNotMatch(line, /\bUUID\b/, `UUID column type in: ${line.trim()}`);
    }
  });

  test("rollback reverses every object this migration adds", () => {
    for (const col of [
      "apollo_person_id", "apollo_organization_id", "apollo_last_synced_at",
      "linkedin_url", "dnc_status", "dnc_checked_at", "phone_type",
      "is_primary_contact", "consent_basis", "consent_basis_set_at",
      "consent_basis_source", "to_phone", "from_phone", "twilio_sid",
      "call_disposition", "call_duration_seconds",
    ]) {
      assert.ok(ROLLBACK.includes(col), `rollback.sql does not reverse ${col}`);
    }
    assert.match(ROLLBACK, /DROP TABLE IF EXISTS "apollo_person_candidates"/i);
    assert.match(ROLLBACK, /DROP TABLE IF EXISTS "apollo_enrichment_runs"/i);
  });
});
