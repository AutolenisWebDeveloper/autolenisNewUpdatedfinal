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

## Migration history hygiene

- Migration timestamps must be unique going forward; never rename or edit a
  migration after it has been applied (it changes the checksum). Add a new
  migration instead.
- The production `_prisma_migrations` ledger was reconciled on 2026-06-20 to
  match the repo 1:1 (correct checksums, no orphans, no duplicate rolled-back
  rows). `prisma migrate status` should report the database is up to date.
