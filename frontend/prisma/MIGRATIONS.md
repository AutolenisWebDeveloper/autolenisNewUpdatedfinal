# Database migrations & provisioning runbook

This document describes how the AutoLenis database is structured across
migration systems and how to provision a **fresh** environment or deploy to an
**existing** one. It reflects the state after the 2026-06-20 schema audit, which
made Prisma the single source of truth for every Prisma model and reconciled the
production migration ledger.

## Source of truth

`prisma/schema.prisma` defines **203 models / 80 enums**. Every one of those
models now has a `CREATE TABLE` in `prisma/migrations/`, so a single
`prisma migrate deploy` fully builds the Prisma-managed schema on an empty
database.

### Baseline reconciliation migrations

Two migrations were added during the audit because 43 models had historically
been created directly in Supabase (raw SQL) and never had a Prisma migration:

- **`20260423999999_baseline_manual_provisioned_tables`** — creates those 43
  tables, their enums and indexes (no foreign keys). It is timestamped to run
  right after the core `20260423…` schema and **before** any later migration
  that `ALTER`s these tables.
- **`20260917000000_baseline_manual_provisioned_fks`** — adds the foreign keys
  for those 43 tables, late enough that every referenced table exists.

Both are fully idempotent (`CREATE … IF NOT EXISTS`, `pg_constraint`/`pg_type`
guards), so they are safe no-ops on databases that already contain the objects.
Their DDL was reverse-engineered from production (zero drift vs `schema.prisma`).

All migrations are written to be **idempotent** so `prisma migrate deploy`
succeeds on environments where objects were created out of band.

## Non-Prisma tables (raw SQL only)

22 tables back the CRM / workflow / email-nurture engine and are accessed via
`supabase-js` / raw SQL rather than Prisma. They are **not** in `schema.prisma`
and are provisioned by the SQL files below:

```
admin_audit_log, campaign_recipients, campaigns, contact_identities,
contact_timeline_events, contacts, conversation_messages, conversations,
crm_tasks, email_suppression, email_template_versions, email_templates,
idempotency_keys, jobs_dead_letter, lead_nurtures, lead_scoring_events,
segments, sms_suppression, workflow_enrollments, workflow_execution_log,
workflow_versions, workflows
```

Their DDL + seed data live in `frontend/migrations/*.sql` (numbered, run in
order) and `prisma/manual_supabase_sql/*.sql`. These files are
idempotent (`IF NOT EXISTS`, `ON CONFLICT`).

> **This directory moved on 2026-08-29** from `prisma/migrations/manual_supabase_sql/`
> to `prisma/manual_supabase_sql/`. Prisma treats every subdirectory of
> `prisma/migrations/` as a migration, so a directory there with no `migration.sql`
> made `prisma migrate deploy` abort with **P3015 on every environment** before
> applying anything. Out-of-band SQL must live beside the migrations directory,
> never inside it. `prisma/__tests__/migration-chain.test.ts` now enforces this.

## Provisioning a FRESH environment

```bash
cd frontend
pnpm prisma migrate deploy          # 1. all Prisma-managed tables (203 models)
# 2. CRM/workflow tables + seed data (run in numeric order):
psql "$DATABASE_URL" -f migrations/01_phase1_foundation.sql
# … through …
psql "$DATABASE_URL" -f migrations/15_welcome_templates.sql
# 3. any remaining one-off SQL in prisma/manual_supabase_sql/ as needed
pnpm prisma generate
pnpm prisma db seed
```

Then create the Supabase Storage buckets listed in `DEPLOYMENT_CHECKLIST.md`.

> **This runbook is CI-verified as of 2026-08-29** — the `migrations` job in
> `.github/workflows/ci.yml` applies the full Prisma chain AND all 15 numbered
> files to an empty postgres on every PR, twice (the second pass proves
> idempotency). Before that, 14 of the 15 numbered files failed on a fresh
> database: `20260911000000` created the acquisition conversation store under
> the bare name `conversations` (the model maps to `acquisition_conversations`),
> which blocked `01_phase1_foundation.sql`'s CRM inbox table of the same name;
> and `05`/`08` used `ON CONFLICT (template_key)` without the
> `WHERE template_key IS NOT NULL` predicate their own partial unique index
> requires, so they had never applied cleanly anywhere.
> `20261018000000_retire_misnamed_conversations_table` retires the orphan,
> shape-guarded so a CRM-shaped production table is untouched.

## Deploying to an EXISTING environment

```bash
cd frontend
pnpm prisma migrate deploy          # idempotent; no-op for already-applied work
```

Never run `prisma db push` or `prisma migrate reset` against production.

## Verifying schema drift

`scripts/schema_drift_audit.py` parses `schema.prisma` into the expected
`(table, column)` set and emits `scripts/drift_check.sql`. Run that SQL against
a database to list any columns Prisma expects but the DB lacks:

```bash
cd frontend
python3 scripts/schema_drift_audit.py     # regenerates scripts/drift_check.sql
# then run scripts/drift_check.sql against the target DB — 0 rows == no drift
```

`scripts/expected_schema.json` is the committed snapshot of the expected schema
for quick diffing.

## Verifying the LEDGER (`_prisma_migrations` is not authoritative)

`_prisma_migrations` records what `prisma migrate deploy` did — **not what the
database contains**. A migration applied out of band leaves the ledger saying
"pending" while the physical schema says "applied". `prisma migrate status` reads
the ledger, so it repeats the same wrong answer with more confidence.

**Before concluding a migration is unapplied, check the physical schema:**
`information_schema.columns`, `pg_constraint`, `pg_indexes`, `pg_enum`.

```bash
cd frontend
DATABASE_URL=<target> pnpm db:check-ledger
```

`scripts/check-ledger-drift.ts` does this for every migration directory that has
no ledger row: it parses the objects the migration creates and asks the database
whether they are already there.

| Verdict | Meaning | Gate |
| --- | --- | --- |
| `APPLIED_NOT_RECORDED` | every object exists, no ledger row | **fail** |
| `PARTIAL` | some objects exist, no ledger row | **fail** |
| `RECORDED_NOT_ON_DISK` | ledger row, no directory | **fail** |
| `PENDING` | no object exists — normal before a deploy | pass |
| `UNVERIFIABLE` | migration creates nothing checkable | pass, reported |

**Repairing ledger drift.** Use `prisma migrate resolve --applied <name>` for each
affected migration in chronological order. It writes the ledger row and executes
no DDL. Do **not** use `prisma migrate deploy` for this — it trusts the ledger and
would re-execute already-applied migrations against the target database.

This is distinct from `pnpm db:check-drift`, which compares a **chain-built**
database against `schema.prisma` and never reads the ledger.

## Migration history hygiene

- Migration timestamps must be unique going forward; never rename or edit a
  migration after it has been applied (it changes the checksum). Add a new
  migration instead.
- The production `_prisma_migrations` ledger was reconciled on 2026-06-20 to
  match the repo 1:1.
- **That reconciliation has since lapsed.** On 2026-09-03 a read-only check of
  production found **six** migrations physically applied with no ledger row:
  `20261014000000_esign_envelope_history`,
  `20261015000000_esign_consent_and_executed_artifact`,
  `20261016000000_ai_action_intent_lifecycle`,
  `20261016000000_contract_scan_version_link`,
  `20261104000000_inventory_market_config_and_call_budget`, and
  `20261105000000_inventory_dealer_provenance_and_call_accounting`. Every object
  each creates was confirmed present. Until they are resolved,
  `prisma migrate status` reports six pending migrations that are **not** pending.
