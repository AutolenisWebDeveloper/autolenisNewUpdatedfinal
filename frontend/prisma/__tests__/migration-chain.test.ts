// prisma/__tests__/migration-chain.test.ts
//
// The migration chain had never been executed against an empty database. CI has
// no database job, so every migration was only ever validated against whatever
// state the live Supabase instance happened to be in when it was written. Four
// defects accumulated unseen, and `prisma migrate deploy` failed at migration
// 22 of 94 on a fresh provision — meaning the chain could not stand up a new
// environment, a preview branch, or a restored database.
//
// The authoritative gate is the CI job that actually applies the chain to an
// empty postgres (.github/workflows/ci.yml -> `migrations`). These are the
// cheap static guards that run without a database and catch the four specific
// defect classes that were found, so the same mistakes fail in `pnpm test:all`
// seconds after they are written rather than in a database job minutes later.
//
// Each guard below is tied to a real defect, not a hypothetical one.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");
const SCHEMA_PATH = join(process.cwd(), "prisma", "schema.prisma");

/** Every immediate subdirectory of prisma/migrations, in Prisma's apply order. */
function migrationDirs(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((e) => statSync(join(MIGRATIONS_DIR, e)).isDirectory())
    .sort(); // Prisma orders lexicographically by directory name.
}

function sqlOf(dir: string): string {
  const p = join(MIGRATIONS_DIR, dir, "migration.sql");
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

/**
 * table name -> set of column names, read from schema.prisma.
 *
 * Column names come from `@map("snake_case")` where present, otherwise the field
 * name verbatim. Relation fields (no @map, type is another model) are harmless
 * extras here: these guards only ever ask "is this name known", never "is this
 * the complete set", so a superset cannot produce a false failure.
 */
function schemaTables(): Map<string, Set<string>> {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  const out = new Map<string, Set<string>>();
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;
  while ((m = modelRe.exec(schema)) !== null) {
    const body = m[2];
    const mapped = body.match(/@@map\("([^"]+)"\)/);
    if (!mapped) continue; // models without @@map are not snake_case tables
    const cols = new Set<string>();
    for (const line of body.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
      const colMap = trimmed.match(/@map\("([^"]+)"\)/);
      if (colMap) {
        cols.add(colMap[1]);
        continue;
      }
      const field = trimmed.match(/^(\w+)\s+\S/);
      if (field) cols.add(field[1]);
    }
    out.set(mapped[1], cols);
  }
  return out;
}


/**
 * Split migration SQL into statement-level chunks: each `DO $$ ... END $$;` block
 * is one chunk, and everything between blocks is split on `;`. This lets a guard
 * ask "is this statement wrapped in a check?" rather than only "does the file
 * mention a check somewhere", which a whole-file match would answer far too
 * generously.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  const doBlock = /DO\s*\$\$[\s\S]*?END\s*\$\$\s*;/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = doBlock.exec(sql)) !== null) {
    out.push(...sql.slice(last, m.index).split(";"));
    out.push(m[0]);
    last = m.index + m[0].length;
  }
  out.push(...sql.slice(last).split(";"));
  return out.filter((s) => s.trim().length > 0);
}

describe("migration chain — structure", () => {
  // DEFECT B1: prisma/migrations/manual_supabase_sql/ held hand-run Supabase SQL
  // and no migration.sql. Prisma treats EVERY subdirectory of migrations/ as a
  // migration, counted 95 where there were 94, and aborted pre-flight with P3015
  // on every environment — not only fresh ones. Out-of-band SQL belongs beside
  // the migrations directory, never inside it.
  test("every directory under prisma/migrations is a real migration", () => {
    const orphans = migrationDirs().filter(
      (d) => !existsSync(join(MIGRATIONS_DIR, d, "migration.sql")),
    );
    assert.deepEqual(
      orphans,
      [],
      "these directories live inside prisma/migrations/ but have no migration.sql, so " +
        "`prisma migrate deploy` aborts with P3015 before applying anything:\n  " +
        orphans.join("\n  ") +
        "\nMove non-migration SQL to prisma/manual_supabase_sql/ instead.",
    );
  });

  test("the chain is non-empty and every migration has readable SQL", () => {
    const dirs = migrationDirs();
    assert.ok(dirs.length > 50, `expected the full chain, found ${dirs.length} migrations`);
    for (const d of dirs) {
      assert.ok(sqlOf(d).trim().length > 0, `${d}/migration.sql is empty`);
    }
  });
});

describe("migration chain — column types match the schema", () => {
  // DEFECT B4: 20260801000005_affiliate_onboarding declared
  // `affiliate_id UUID ... REFERENCES affiliates(id)`, but affiliates.id is TEXT
  // (Prisma `String @default(uuid())` maps to TEXT, not the postgres uuid type).
  // Postgres refuses the foreign key with 42804 "cannot be implemented". That
  // migration could never have applied to ANY database.
  //
  // RE-SCOPED 2026-09-06 (Phase 1). The original premise — "schema.prisma contains
  // zero @db.Uuid, so any UUID in SQL is unambiguously a mistake" — stopped being
  // true, and the guard itself said to re-scope rather than delete when it did.
  //
  // THREE tables in PRODUCTION genuinely have a `uuid` primary key:
  // comms_outbox, lifecycle_touch_schedule and jobs_dead_letter. That was read off
  // the committed production baseline, not assumed. They were created outside the
  // migration chain and were never declared in schema.prisma; the Phase 1 wave
  // adopts them with CREATE TABLE IF NOT EXISTS, which must mirror the shape
  // production actually has, and declares them as models with @db.Uuid.
  //
  // So the blanket ban is replaced by the invariant it was a proxy for: a UUID
  // column is allowed ONLY on those three adopted tables, and — the part that
  // actually matters — no foreign key may cross the uuid/text boundary. The
  // exemption is a fixed, named list with a reason, not a loophole: any OTHER
  // UUID declaration still fails, and adding to the list is a reviewable diff.
  const ADOPTED_UUID_TABLES = ["comms_outbox", "lifecycle_touch_schedule", "jobs_dead_letter"];

  test("no migration declares a postgres UUID column outside the adopted tables", () => {
    const schema = readFileSync(SCHEMA_PATH, "utf8");
    // @db.Uuid may appear ONLY on models mapping to the three adopted tables.
    const uuidModels: string[] = [];
    for (const m of schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
      if (!/@db\.Uuid/.test(m[2])) continue;
      const mapped = /@@map\("([^"]+)"\)/.exec(m[2]);
      uuidModels.push(mapped ? mapped[1] : m[1]);
    }
    assert.deepEqual(
      uuidModels.filter((t) => !ADOPTED_UUID_TABLES.includes(t)),
      [],
      "a model outside the three adopted tables declares @db.Uuid; every other id in " +
        "schema.prisma is String/TEXT and a foreign key across that boundary cannot be created",
    );

    const offenders: string[] = [];
    for (const d of migrationDirs()) {
      // Match \bUUID\b CASE-SENSITIVELY: the SQL type is written UUID, while the
      // generator function is gen_random_uuid() in lower case. An earlier version
      // of this guard skipped any line containing "uuid(", which silently excused
      // `"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()` — half of the very
      // defect it exists to catch. Comments are stripped first so the prose in a
      // migration header cannot trip it.
      // Track which CREATE TABLE block each line sits in, so the exemption applies
      // to the three adopted tables and to nothing else in the same file.
      let currentTable: string | null = null;
      for (const line of sqlOf(d).split("\n")) {
        const code = line.replace(/--.*$/, "");
        const create = /CREATE TABLE (?:IF NOT EXISTS )?"?(\w+)"?/i.exec(code);
        if (create) currentTable = create[1];
        // Reset on ANY statement terminator, not only a bare `);` on its own line. A single-line
        // `CREATE TABLE ... ( ... );` would otherwise leave currentTable set for the rest of the
        // file and silently exempt every later UUID declaration in it.
        if (/;\s*$/.test(code)) currentTable = null;
        if (/\bUUID\b/.test(code) && !(currentTable && ADOPTED_UUID_TABLES.includes(currentTable))) {
          offenders.push(`${d}: ${line.trim()}`);
        }
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "these declare a postgres UUID column outside the three adopted tables, while every other " +
        "id in schema.prisma is String/TEXT; a foreign key across that type boundary cannot be " +
        "created:\n  " +
        offenders.join("\n  "),
    );
  });

  // The invariant the ban was standing in for. The three adopted tables carry uuid
  // ids, so a foreign key with one of them on either end would join uuid to text
  // and be refused with 42804. Today none exists — comms_outbox's three reference
  // columns are deliberately keyless correlation keys (owner-confirmed 2026-09-06)
  // — and this keeps it that way as later phases add keys around them.
  test("no foreign key crosses the uuid/text boundary", () => {
    const offenders: string[] = [];
    for (const d of migrationDirs()) {
      const sql = sqlOf(d).replace(/--.*$/gm, "");
      for (const t of ADOPTED_UUID_TABLES) {
        // a key whose PARENT is an adopted uuid table
        const asParent = new RegExp(`REFERENCES\\s+"?${t}"?\\s*\\(`, "i");
        if (asParent.test(sql)) offenders.push(`${d}: a foreign key REFERENCES ${t}`);
        // a key declared ON an adopted uuid table
        const asChild = new RegExp(
          `ALTER TABLE\\s+"?${t}"?[^;]*?(?:ADD CONSTRAINT[^;]*?)?FOREIGN KEY`, "is");
        if (asChild.test(sql)) offenders.push(`${d}: a foreign key is declared ON ${t}`);
      }
    }
    assert.deepEqual(
      offenders,
      [],
      "a foreign key joins one of the uuid-keyed adopted tables to a TEXT id; postgres refuses " +
        "that with 42804:\n  " + offenders.join("\n  "),
    );
  });
});

describe("migration chain — backfills reference columns that exist", () => {
  // DEFECT B2: 20260507000000 ran
  //   UPDATE "prequal_consents" SET "accepted_at" = "created_at"
  // but prequal_consents has never had a created_at column — not in the migration
  // that creates it (20260428000000) and not in the PrequalConsent model. This is
  // where `migrate deploy` died on a fresh database, at migration 22 of 94.
  test("no backfill copies from a column the table does not have", () => {
    const tables = schemaTables();
    const offenders: string[] = [];

    for (const d of migrationDirs()) {
      // A backfill is acceptable if the column it reads is either in the schema,
      // or the UPDATE sits inside a DO block that first proves the column exists.
      // The second form is how a legacy-only column is handled safely: the
      // statement is skipped on databases that never had it.
      for (const block of splitStatements(sqlOf(d))) {
        const re = /UPDATE\s+"(\w+)"\s+SET\s+"(\w+)"\s*=\s*"(\w+)"/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(block)) !== null) {
          const [, table, , source] = m;
          const cols = tables.get(table);
          if (!cols) continue; // table not in schema.prisma — nothing to check against
          if (cols.has(source)) continue;
          const guarded =
            /information_schema\.columns/i.test(block) &&
            new RegExp(`column_name\\s*=\\s*'${source}'`, "i").test(block);
          if (!guarded) {
            offenders.push(
              `${d}: UPDATE "${table}" SET ... = "${source}" — no such column on ${table}, ` +
                `and no information_schema guard proving it exists`,
            );
          }
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "these backfills read a column that does not exist, so the migration fails with " +
        "42703 on any database that reaches it:\n  " +
        offenders.join("\n  "),
    );
  });
});

describe("migration chain — same-timestamp migrations are order-independent", () => {
  // DEFECT B3: 20260702000000_add_admin_mfa_lockout and
  // 20260702000000_add_admin_mfa_rate_limit share a timestamp. Prisma orders by
  // directory NAME, so "lockout" applies first — the opposite of what
  // rate_limit's own comment assumes ("mfa_failed_attempts was already added by
  // add_admin_mfa_rate_limit"). lockout adds the columns with IF NOT EXISTS;
  // rate_limit then re-added them bare and failed with 42701.
  //
  // Renaming a directory would make Prisma treat it as a NEW migration and
  // re-apply it where the old name is already recorded, so the fix is not
  // renaming: migrations that share a timestamp must be safe in either order.
  test("migrations sharing a timestamp add columns idempotently", () => {
    const byStamp = new Map<string, string[]>();
    for (const d of migrationDirs()) {
      const stamp = d.split("_")[0];
      if (!/^\d{14}$/.test(stamp)) continue;
      byStamp.set(stamp, [...(byStamp.get(stamp) ?? []), d]);
    }

    const offenders: string[] = [];
    for (const [stamp, dirs] of byStamp) {
      if (dirs.length < 2) continue;
      for (const d of dirs) {
        // Within a timestamp collision the apply order is not meaningful, so any
        // non-idempotent ADD COLUMN is a coin flip between success and 42701.
        const bare = sqlOf(d).match(/ADD COLUMN\s+(?!IF NOT EXISTS)"/gi);
        if (bare) {
          offenders.push(
            `${d} (shares timestamp ${stamp} with ${dirs.filter((x) => x !== d).join(", ")}): ` +
              `${bare.length} non-idempotent ADD COLUMN`,
          );
        }
      }
    }

    assert.deepEqual(
      offenders,
      [],
      "these migrations share a timestamp with another, so their relative order is " +
        "decided by directory name rather than intent. Every ADD COLUMN among them " +
        "must use IF NOT EXISTS:\n  " +
        offenders.join("\n  "),
    );
  });
});

describe("migration chain — tables that survive the chain belong to the schema", () => {
  // DEFECT (Batch 7): 20260911000000_add_acquisition_system created its table
  // under the bare name "conversations" while the Conversation model maps to
  // "acquisition_conversations" — which 20260423999999 had already created. No
  // model, and no code path, ever touched the bare table on a chain-built
  // database. It was pure squatting, and the name it squatted on is the one
  // the CRM provisioning runbook (frontend/migrations/01_phase1_foundation.sql)
  // needs for the LIVE admin-CRM inbox table: its CREATE TABLE IF NOT EXISTS
  // silently skipped, the transaction rolled back, and 14 of the 15 documented
  // provisioning files failed on a fresh database.
  //
  // The guard: compute the NET set of tables the chain leaves behind (created
  // and not later dropped) and require every one to be an @@map'd table in
  // schema.prisma. Transient tables (created then dropped inside the chain,
  // e.g. refinance_partners in the 20260424030000 rebuild) are fine; a SURVIVOR
  // no model owns is a name collision waiting for whoever needs that name next.
  test("every table the chain leaves behind is @@map'd in schema.prisma", () => {
    const schemaNames = new Set(schemaTables().keys());
    const surviving = new Set<string>();

    for (const d of migrationDirs()) {
      // Strip SQL comments FIRST. The first version of this guard did not, and
      // passed when it should have failed: 20261017000000's header comment
      // mentions `DROP TABLE "conversations"` in prose, and that prose deleted
      // the orphan from the surviving set. A parser that reads comments as
      // statements is Observation-6 all over again — prove the guard against
      // the defect before trusting it.
      const sql = sqlOf(d).replace(/--.*$/gm, "");
      const create = /CREATE TABLE (?:IF NOT EXISTS )?"?([a-zA-Z_]+)"?/g;
      const drop = /DROP TABLE (?:IF EXISTS )?"?([a-zA-Z_]+)"?/g;
      let m: RegExpExecArray | null;
      while ((m = create.exec(sql)) !== null) surviving.add(m[1]);
      while ((m = drop.exec(sql)) !== null) surviving.delete(m[1]);
    }

    const orphans = [...surviving].filter((t) => !schemaNames.has(t)).sort();
    assert.deepEqual(
      orphans,
      [],
      "these tables are created by the migration chain but no schema.prisma model " +
        "@@maps to them — nothing in the app can reach them, and they squat on names " +
        "other systems may need:\n  " +
        orphans.join("\n  "),
    );
  });
});
