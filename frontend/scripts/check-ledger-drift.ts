/**
 * Ledger drift gate — is `_prisma_migrations` telling the truth about this database?
 *
 * THE FAILURE THIS EXISTS TO CATCH. On 2026-09-03 six migrations were physically
 * present in production — every column, index, foreign key and enum label — while
 * `_prisma_migrations` had no row for any of them. They had been applied out of
 * band, so the ledger said "pending" and the physical schema said "applied".
 *
 * Reading the ledger alone produced a false conclusion three times in a row: a
 * P2022 exposure was reported against routes that were never at risk, because
 * `prisma migrate status` reports pending-ness from the ledger and cannot see a
 * single column. The reverse mistake is worse — `prisma migrate deploy` also
 * trusts the ledger, so it would have re-run six already-applied migrations
 * against production.
 *
 * WHY NEITHER EXISTING GATE COVERS IT.
 *
 *   `pnpm db:check-drift` (scripts/check-migration-drift.ts) compares a database
 *   built from `prisma/migrations` against `schema.prisma`. Its input is a chain
 *   built from EMPTY, where the ledger is complete by construction. It never
 *   reads `_prisma_migrations` and never looks at a live database.
 *
 *   `prisma migrate status` compares the ledger to the directory listing. That is
 *   exactly the half of the picture that was wrong; it is the tool that misled us.
 *
 *   `prisma migrate diff` compares two schemas. It cannot attribute a difference
 *   to a migration, so it cannot say "this migration's objects exist but its row
 *   is missing".
 *
 * WHAT THIS DOES. For every migration directory with no ledger row, it parses the
 * objects the migration creates and asks the database whether they are already
 * there:
 *
 *   APPLIED_NOT_RECORDED  every object exists, no ledger row   -> FAIL (the drift)
 *   PARTIAL               some objects exist, no ledger row    -> FAIL (worse)
 *   PENDING               no object exists                     -> ok, normal
 *   UNVERIFIABLE          migration creates no checkable object -> reported, not failed
 *
 * and the reverse direction:
 *
 *   RECORDED_NOT_ON_DISK  ledger row with no directory         -> FAIL
 *
 * PENDING is deliberately not a failure. A written-but-unapplied migration is a
 * normal pre-deploy state and is the whole point of shipping migrations for owner
 * review. What must never pass silently is the ledger disagreeing with the disk.
 *
 * USAGE. Point DATABASE_URL at the database whose ledger you want to trust:
 *
 *   cd frontend && DATABASE_URL=<url> pnpm db:check-ledger
 *
 * Read-only: it issues SELECTs against system catalogues and `_prisma_migrations`
 * and writes nothing, so it is safe to run against production.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Object extraction — pure, unit-tested without a database.
// ---------------------------------------------------------------------------

export type ObjectKind = "table" | "column" | "index" | "constraint" | "type" | "enumValue";

export interface DbObject {
  kind: ObjectKind;
  /** Owning table for `column`, owning enum type for `enumValue`; else undefined. */
  parent?: string;
  name: string;
}

/** Executable SQL only. A `-- DROP nothing` comment must not read as a DROP. */
export function stripComments(sql: string): string {
  return sql
    .split("\n")
    .map((line) => line.split("--")[0])
    .join("\n");
}

/**
 * Parse the objects a migration creates.
 *
 * Deliberately covers only the statement forms this chain actually uses. Anything
 * it does not recognise is simply not extracted, which downgrades a migration to
 * UNVERIFIABLE rather than silently judging it — a parser gap must never be able
 * to manufacture a verdict.
 */
export function extractObjects(sql: string): DbObject[] {
  const text = stripComments(sql);
  const objects: DbObject[] = [];
  const seen = new Set<string>();

  const push = (o: DbObject) => {
    const key = `${o.kind}:${o.parent ?? ""}:${o.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    objects.push(o);
  };

  // `ALTER TABLE "t"` may be followed by several `ADD COLUMN`/`ADD CONSTRAINT`
  // clauses on later lines, so the owning table is tracked as the scan advances.
  let currentTable: string | null = null;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;

    const alterTable = line.match(/ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?"([^"]+)"/i);
    if (alterTable) currentTable = alterTable[1]!;

    const createTable = line.match(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i);
    if (createTable) {
      currentTable = createTable[1]!;
      push({ kind: "table", name: createTable[1]! });
    }

    // Multiple ADD COLUMN clauses can share one line; matchAll covers both forms.
    for (const m of line.matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/gi)) {
      if (currentTable) push({ kind: "column", parent: currentTable, name: m[1]! });
    }

    for (const m of line.matchAll(/ADD\s+CONSTRAINT\s+"([^"]+)"/gi)) {
      push({ kind: "constraint", name: m[1]! });
    }

    const createIndex = line.match(
      /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?"([^"]+)"/i,
    );
    if (createIndex) push({ kind: "index", name: createIndex[1]! });

    const createType = line.match(/CREATE\s+TYPE\s+"([^"]+)"\s+AS\s+ENUM/i);
    if (createType) push({ kind: "type", name: createType[1]! });

    const addValue = line.match(
      /ALTER\s+TYPE\s+"([^"]+)"\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/i,
    );
    if (addValue) push({ kind: "enumValue", parent: addValue[1]!, name: addValue[2]! });
  }

  return objects;
}

// ---------------------------------------------------------------------------
// Classification — pure, unit-tested without a database.
// ---------------------------------------------------------------------------

export type Verdict =
  | "APPLIED_NOT_RECORDED"
  | "PARTIAL"
  | "PENDING"
  | "UNVERIFIABLE";

export interface Classification {
  verdict: Verdict;
  present: DbObject[];
  absent: DbObject[];
}

export function classify(objects: DbObject[], exists: (o: DbObject) => boolean): Classification {
  if (objects.length === 0) return { verdict: "UNVERIFIABLE", present: [], absent: [] };

  const present = objects.filter(exists);
  const absent = objects.filter((o) => !exists(o));

  if (absent.length === 0) return { verdict: "APPLIED_NOT_RECORDED", present, absent };
  if (present.length === 0) return { verdict: "PENDING", present, absent };
  return { verdict: "PARTIAL", present, absent };
}

/** A verdict that means the ledger disagrees with the physical schema. */
export function isDrift(v: Verdict): boolean {
  return v === "APPLIED_NOT_RECORDED" || v === "PARTIAL";
}

// ---------------------------------------------------------------------------
// Ledger interpretation — pure, unit-tested without a database.
// ---------------------------------------------------------------------------

export interface LedgerRow {
  migration_name: string;
  finished_at: Date | null;
  rolled_back_at: Date | null;
}

export interface LedgerState {
  /** Names with at least one successful row. These count as applied. */
  recorded: Set<string>;
  /**
   * Rows that claim nothing AND have no successful counterpart. A migration that
   * was rolled back and then re-applied leaves BOTH rows behind — that is a
   * healthy history, so flagging its rolled-back row would fail a correct
   * database. Only a name with no successful row at all is a real problem.
   */
  unusable: LedgerRow[];
}

export function readLedger(rows: LedgerRow[]): LedgerState {
  const recorded = new Set(
    rows.filter((r) => r.finished_at && !r.rolled_back_at).map((r) => r.migration_name),
  );
  const unusable = rows.filter(
    (r) => (!r.finished_at || r.rolled_back_at) && !recorded.has(r.migration_name),
  );
  return { recorded, unusable };
}

// ---------------------------------------------------------------------------
// Live-database inventory.
// ---------------------------------------------------------------------------

export interface SchemaInventory {
  tables: Set<string>;
  columns: Set<string>; // `table.column`
  indexes: Set<string>;
  constraints: Set<string>;
  types: Set<string>;
  enumValues: Set<string>; // `type.label`
}

export function objectExists(inv: SchemaInventory, o: DbObject): boolean {
  switch (o.kind) {
    case "table":
      return inv.tables.has(o.name);
    case "column":
      return inv.columns.has(`${o.parent}.${o.name}`);
    case "index":
      return inv.indexes.has(o.name);
    case "constraint":
      return inv.constraints.has(o.name);
    case "type":
      return inv.types.has(o.name);
    case "enumValue":
      return inv.enumValues.has(`${o.parent}.${o.name}`);
  }
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(process.cwd(), "prisma", "migrations");

export function migrationDirsOnDisk(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "migration.sql")))
    .map((e) => e.name)
    .sort();
}

async function main(): Promise<number> {
  if (!process.env.DATABASE_URL) {
    console.error(
      "DATABASE_URL is required — point it at the database whose ledger you want to verify.",
    );
    process.exit(1);
  }

  // Imported lazily so the pure exports above stay importable (and unit-testable)
  // without a generated client or a reachable database.
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);

    const [ledgerRows, tables, columns, indexes, constraints, types, enumValues] = await Promise.all(
      [
        q<LedgerRow>(
          `SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`,
        ),
        q<{ tablename: string }>(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`),
        // pg_attribute, not information_schema.columns: the information_schema
        // views filter to objects the CURRENT ROLE has privileges on, while every
        // other query here reads pg_catalog, which does not. Mixing the two lets a
        // permission gap masquerade as a missing column — a spurious PARTIAL.
        // attnum > 0 excludes system columns; attisdropped excludes dropped ones.
        q<{ table_name: string; column_name: string }>(
          `SELECT c.relname AS table_name, a.attname AS column_name
             FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped`,
        ),
        q<{ indexname: string }>(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`),
        // Constraint and type names are schema-scoped, so these are filtered to
        // `public` too. Counting a same-named object in another schema as present
        // would mask a partial application as a clean one.
        q<{ conname: string }>(
          `SELECT c.conname FROM pg_constraint c
             JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`,
        ),
        q<{ typname: string }>(
          `SELECT t.typname FROM pg_type t
             JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'`,
        ),
        q<{ typname: string; enumlabel: string }>(
          `SELECT t.typname, e.enumlabel FROM pg_enum e
             JOIN pg_type t ON t.oid = e.enumtypid
             JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'`,
        ),
      ],
    );

    const inv: SchemaInventory = {
      tables: new Set(tables.map((r) => r.tablename)),
      columns: new Set(columns.map((r) => `${r.table_name}.${r.column_name}`)),
      indexes: new Set(indexes.map((r) => r.indexname)),
      constraints: new Set(constraints.map((r) => r.conname)),
      types: new Set(types.map((r) => r.typname)),
      enumValues: new Set(enumValues.map((r) => `${r.typname}.${r.enumlabel}`)),
    };

    const { recorded, unusable: unusableRows } = readLedger(ledgerRows);

    const onDisk = migrationDirsOnDisk();

    console.log("Ledger drift (_prisma_migrations vs the physical schema)\n");
    console.log(`  migration directories on disk: ${onDisk.length}`);
    console.log(`  usable ledger rows:            ${recorded.size}\n`);

    let failed = false;

    // --- Direction 1: on disk, no ledger row. -------------------------------
    const unrecorded = onDisk.filter((name) => !recorded.has(name));
    const buckets: Record<Verdict, string[]> = {
      APPLIED_NOT_RECORDED: [],
      PARTIAL: [],
      PENDING: [],
      UNVERIFIABLE: [],
    };
    const detail = new Map<string, Classification>();

    for (const name of unrecorded) {
      const sql = readFileSync(join(MIGRATIONS_DIR, name, "migration.sql"), "utf8");
      const c = classify(extractObjects(sql), (o) => objectExists(inv, o));
      buckets[c.verdict].push(name);
      detail.set(name, c);
    }

    if (buckets.APPLIED_NOT_RECORDED.length > 0) {
      failed = true;
      console.log(
        `  FAIL     applied but NOT recorded: ${buckets.APPLIED_NOT_RECORDED.length}\n` +
          `           Every object these migrations create already exists, yet they have no\n` +
          `           ledger row. 'prisma migrate deploy' would re-run them against this\n` +
          `           database. Repair the ledger with 'prisma migrate resolve --applied <name>'\n` +
          `           for each, in chronological order, then re-run this check.`,
      );
      for (const n of buckets.APPLIED_NOT_RECORDED) {
        console.log(`             - ${n} (${detail.get(n)!.present.length} objects, all present)`);
      }
    } else {
      console.log("  ok       applied but NOT recorded: 0");
    }

    if (buckets.PARTIAL.length > 0) {
      failed = true;
      console.log(
        `  FAIL     partially applied: ${buckets.PARTIAL.length}\n` +
          `           Some objects exist and some do not, with no ledger row. This needs a\n` +
          `           human: neither 'migrate deploy' nor 'migrate resolve' is safe until the\n` +
          `           real state is established.`,
      );
      for (const n of buckets.PARTIAL) {
        const c = detail.get(n)!;
        console.log(`             - ${n}`);
        for (const o of c.present) console.log(`                 present: ${o.kind} ${o.parent ? `${o.parent}.` : ""}${o.name}`);
        for (const o of c.absent) console.log(`                 ABSENT:  ${o.kind} ${o.parent ? `${o.parent}.` : ""}${o.name}`);
      }
    } else {
      console.log("  ok       partially applied: 0");
    }

    // --- Direction 2: ledger row, no directory. -----------------------------
    const orphanRows = [...recorded].filter((n) => !onDisk.includes(n)).sort();
    if (orphanRows.length > 0) {
      failed = true;
      console.log(
        `  FAIL     recorded but NOT on disk: ${orphanRows.length}\n` +
          `           The ledger claims migrations this checkout does not contain. A migration\n` +
          `           directory was deleted or renamed after being applied.`,
      );
      for (const n of orphanRows) console.log(`             - ${n}`);
    } else {
      console.log("  ok       recorded but NOT on disk: 0");
    }

    // --- Informational: normal pre-deploy state. ----------------------------
    if (unusableRows.length > 0) {
      failed = true;
      console.log(`  FAIL     unfinished or rolled-back ledger rows: ${unusableRows.length}`);
      for (const r of unusableRows) {
        console.log(
          `             - ${r.migration_name} finished_at=${r.finished_at ?? "NULL"} ` +
            `rolled_back_at=${r.rolled_back_at ?? "NULL"}`,
        );
      }
    }

    if (buckets.PENDING.length > 0) {
      console.log(
        `\n  info     genuinely pending: ${buckets.PENDING.length} ` +
          `(no ledger row, no object present — normal before a deploy)`,
      );
      for (const n of buckets.PENDING) console.log(`             - ${n}`);
    }

    if (buckets.UNVERIFIABLE.length > 0) {
      console.log(
        `\n  info     unverifiable: ${buckets.UNVERIFIABLE.length} ` +
          `(no ledger row, and the migration creates no object this checker can test —\n` +
          `           data-only, or a statement form the parser does not cover)`,
      );
      for (const n of buckets.UNVERIFIABLE) console.log(`             - ${n}`);
    }

    if (failed) {
      console.error("\nFAIL: the ledger does not describe this database.");
      return 1;
    }

    console.log("\nOK — every migration's ledger row agrees with the physical schema.");
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when invoked directly, so the pure helpers above can be imported by tests.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
