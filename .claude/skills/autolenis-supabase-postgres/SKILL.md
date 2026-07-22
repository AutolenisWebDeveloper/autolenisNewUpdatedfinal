---
name: autolenis-supabase-postgres
description: >-
  The database constitution for AutoLenis — Prisma 5 schema authoring, Supabase
  PostgreSQL migrations, RLS policy standards, indexes, constraints,
  transactions, idempotency tables, and zero-downtime + rollback discipline. Use
  this skill when adding or altering anything in frontend/prisma/schema.prisma,
  writing a migration under frontend/prisma/migrations/, changing an enum,
  index, constraint, or foreign key, deciding Prisma-vs-Supabase-client access,
  writing RLS policies, doing a backfill, or reasoning about connection pooling,
  transactions, or deletion cascades. Keywords: Prisma, migration, RLS, index,
  constraint, foreign key, enum, backfill, rollback, Supabase, service role,
  transaction. Overrides generic SQL/ORM guidance.
---

## Purpose & Authority

This skill owns every schema change and data-access decision in AutoLenis. It is
the source of truth for how models are defined in Prisma, how migrations are
authored against Supabase PostgreSQL (project ref `aieybibvewmvrubcpthm`), how
RLS is applied, and how a change ships safely without downtime or data loss.
Every schema change is a package: **migration + constraints + indexes + RLS +
backfill + rollback + tests** — not just a Prisma model edit. Where generic ORM
advice ("just run `prisma migrate dev` and push", "add the column, backfill
later", "RLS is optional") conflicts with anything here, this skill wins.

## When this skill activates

- Editing `frontend/prisma/schema.prisma` (~200 models) or any enum.
- Adding a migration under `frontend/prisma/migrations/` (timestamped dir +
  `migration.sql`), or hand-written SQL in
  `frontend/prisma/migrations/manual_supabase_sql/`.
- Adding/altering a table, column, index, constraint, FK, or default.
- Writing or reviewing RLS policies.
- Choosing between the Prisma client, the RLS-scoped Supabase client, and the
  service-role client.
- Backfills, data migrations, connection/pooling concerns, or transactions.
- Keywords: migration, RLS, index, unique constraint, foreign key, cascade,
  backfill, rollback, `$transaction`, service role, `execute_sql`.

## Architecture & key files

- **Schema:** `frontend/prisma/schema.prisma` — single file, `@@map` snake_case
  table names, `@map` snake_case columns, `uuid()` PKs, `@default(now())` /
  `@updatedAt` timestamps. Money is always `Int` `*_cents` columns (minor
  units), never `Float`/`Decimal` for currency.
- **Migrations:** `frontend/prisma/migrations/<timestamp>_<name>/migration.sql`
  (69+ applied), `migration_lock.toml`, plus a `manual_supabase_sql/` folder for
  out-of-band Supabase SQL (buckets, RLS enablement, manual-provisioned tables).
- **Access clients:**
  - `lib/prisma.ts` — `prisma` singleton (globalForPrisma pattern). Primary
    server-side data access; connects as table owner → **bypasses RLS**.
  - `lib/supabase.ts` — `createServerSupabaseClient` (anon key, **RLS-scoped**
    to the signed-in user), `createBrowserSupabaseClient`,
    `createServiceSupabaseClient`.
  - `lib/supabase-service.ts` — `getServiceSupabase` (`server-only`,
    `SUPABASE_SERVICE_ROLE_KEY`, **bypasses RLS**; call only after server-side
    authorization).
- **Idempotency/DLQ tables:** `idempotency_keys` (key_hash unique,
  execution_status) and `jobs_dead_letter` — used by `lib/inngest/idempotency.ts`
  and QStash workers. `PaymentProviderEvent`/`WebhookEvent` (unique on eventId)
  are the webhook idempotency claim records.
- **Migration style (from real migrations):** `CREATE TABLE IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`, and `ADD CONSTRAINT` guarded by
  `DO $$ ... to_regclass(...) IS NOT NULL ... $$` blocks so re-runs are
  idempotent. FKs declared with explicit `ON DELETE`/`ON UPDATE`.

## Core rules & invariants

1. **Prisma migration is the front door for schema.** Change
   `schema.prisma`, then generate/author the paired `migration.sql`. Never edit
   an already-applied migration; add a new one. Never hand-edit production tables
   outside the migration trail.
2. **Every table has RLS enabled.** The established pattern is RLS enabled with
   deny-all for `anon`/`authenticated` (all legitimate access is server-side via
   Prisma or the service-role key). A new table with RLS disabled is a
   Supabase-advisor finding (`rls_disabled_in_public`) and is not acceptable —
   see `20260918000000_enable_rls_manual_tables`.
3. **Prisma bypasses RLS; the anon Supabase client does not.** Server code that
   has already authorized the actor uses `prisma` (or the service client). Any
   client-reachable path must go through the RLS-scoped anon client and rely on
   policies. Never expose a table to the client assuming "the API checks it".
4. **Money is integer `*_cents`.** No floating-point currency. Amounts,
   credits, and nets are separate `Int` columns (e.g. `amountCents`,
   `depositCreditCents`, `netAmountCents`).
5. **Constraints belong in the database.** Uniqueness (e.g. Stripe
   `paymentIntentId`, `eventId`, `idempotency_keys.key_hash`) is a DB unique
   index, not app logic. FKs declare explicit `ON DELETE` (`Cascade` for owned
   children, `SetNull` for optional references) matching the Prisma
   `onDelete`. Add `NOT NULL` + defaults deliberately.
6. **Index every foreign key and every hot query predicate.** Match the
   `@@index`/`@@unique` in Prisma with `CREATE INDEX IF NOT EXISTS` in SQL.
   Composite indexes follow the actual filter+sort order (e.g.
   `(buyer_id, created_at)`).
7. **Zero-downtime, expand/contract.** Additive first (nullable column or new
   table) → backfill → enforce (`NOT NULL`/constraint) → later drop. Never
   rename-in-place or drop-and-recreate a column with live data. Build indexes
   `CONCURRENTLY` on large tables where possible.
8. **Every migration is idempotent and reversible.** Guard with
   `IF NOT EXISTS` / `to_regclass` blocks. Author a documented rollback path
   (down SQL or a compensating forward migration). No destructive change ships
   without a tested rollback.
9. **Enums are append-only in practice.** Add values; never renumber or remove a
   value in use. The canonical status enums (VehicleRequestStatus, AuctionStatus,
   DealStatus, DepositStatus, ESignStatus, PickupStatus, PreQualDecision, etc.)
   are contracts — extend, don't repurpose values.
10. **Transactions for multi-write invariants.** Money clusters and state
    transitions run inside `prisma.$transaction` with the idempotency claim
    (see the Stripe webhook: claim + deposit PAID + auction create commit
    atomically). Keep transactions short; do network I/O outside them.

## Workflows

**Add a column.** Edit `schema.prisma` (nullable to start) → author
`migration.sql` (`ADD COLUMN IF NOT EXISTS`, guarded) → backfill via a batched
script/endpoint (never a single unbounded `UPDATE` on a large table) → in a
follow-up migration set `NOT NULL`/default once backfill is verified → add
matching index if it will be filtered on → update repository/service code and
tests → document rollback (drop column).

**Add a table.** Model with `@@map`, PK, timestamps, FKs, `@@index` → SQL with
`CREATE TABLE IF NOT EXISTS`, guarded index/constraint blocks, explicit FK
`ON DELETE`/`ON UPDATE` → `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
(deny-all unless a client path genuinely needs a policy) → seed/backfill if
needed → tests → rollback (drop table).

**Add a status value.** Extend the Prisma enum → migration
`ALTER TYPE ... ADD VALUE IF NOT EXISTS` → update every switch/guard that
exhausts the enum (transition maps, `allowedPredecessors`, status-history
writers) → tests for the new transition. Never reorder existing values.

**Backfill.** Idempotent and resumable, batched by PK range or `updated_at`,
throttled, with progress logging. Provide a manual re-run endpoint/script.
Backfills run off the request path (Inngest/QStash/script), never inline in a
migration for large tables.

**Choosing an access client.** Authorized server route → `prisma`. Client- or
edge-reachable read that must respect per-user visibility → RLS-scoped anon
client. Cross-tenant admin/CRM operation after authz → `getServiceSupabase`
(service role). Never reach for the service role to skip a check.

## Boundaries — do / never

**Do**
- Ship schema changes as migration + constraints + indexes + RLS + backfill +
  rollback + tests, together.
- Keep migrations idempotent (`IF NOT EXISTS`, `to_regclass` guards).
- Enable RLS on every new table; default to deny-all.
- Enforce uniqueness and FKs in the DB; index every FK.
- Use `$transaction` for multi-write invariants and money clusters.

**Never**
- Edit an applied migration or hand-mutate production schema outside the trail.
- Add a table without RLS, or expose a table to the client assuming the API
  guards it.
- Use `Float`/`Decimal` for currency.
- Rename/drop a column in place on live data, or drop without a rollback.
- Remove/renumber an in-use enum value.
- Run an unbounded backfill `UPDATE` inline in a migration.
- Use the service-role client to bypass an ownership/authorization check.
- Build a second idempotency or dead-letter table — reuse `idempotency_keys` /
  `jobs_dead_letter`.

## Best practices & examples

- Idempotency guard pattern (`lib/inngest/idempotency.ts`): insert a
  `processing` row keyed on `sha256(identity)`; a `23505` unique violation means
  another worker owns it → converge instead of duplicating.
- Webhook idempotency: the unique `eventId` row on
  `PaymentProviderEvent`/`WebhookEvent` is the claim; a transactional
  `updateMany(where processed:false → processed:true)` returning count 0 means a
  concurrent delivery won — ack as duplicate.
- Match Prisma and SQL exactly: a Prisma `@@unique([shortlistId, inventoryItemId])`
  must have the corresponding SQL unique index in the migration.
- Prefer partial/covering indexes for status-scoped hot paths (e.g. only
  `status = 'ACTIVE'` rows) when the table is large.

## Acceptance criteria

- [ ] `schema.prisma` and a new (never edited) `migration.sql` are in sync.
- [ ] Migration is idempotent and guarded; a rollback path is written and tested.
- [ ] New table has RLS enabled (deny-all unless a client policy is justified).
- [ ] Every FK indexed; hot predicates indexed; uniqueness enforced in the DB.
- [ ] Currency stays integer `*_cents`.
- [ ] Change follows expand → backfill → enforce; no in-place rename/drop on live
      data.
- [ ] Backfill is batched, idempotent, resumable, and off the request path.
- [ ] Enum changes are additive; all exhaustive switches updated.
- [ ] Multi-write invariants wrapped in `$transaction`; no long network I/O
      inside transactions.
- [ ] Correct access client chosen (Prisma vs RLS-scoped vs service role).

## Cross-skill links

- `autolenis-domain-model` — canonical entities, relationships, and status
  enums that migrations must honor.
- `autolenis-auth-security-privacy` — RLS intent, PII encryption columns,
  service-role rules.
- `autolenis-payments-and-ledger` — money-cents columns, Stripe idempotency
  tables, transactional money clusters.
- `autolenis-observability-sre` — DLQ/idempotency tables, backfill/job
  monitoring.
- `autolenis-system-architecture` — data-access layering and the
  no-parallel-systems rule.
