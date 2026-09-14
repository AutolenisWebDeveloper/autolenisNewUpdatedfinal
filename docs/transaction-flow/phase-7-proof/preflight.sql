-- Phase 7 DEPLOY-TIME preflight. Run READ-ONLY against PRODUCTION immediately before
-- `prisma migrate deploy`, inside the same window as the deploy itself.
--
-- CONTRACT, the same shape as `phase-1-proof/preflight.sql`:
--     PASS  <=>  no row has status = 'BLOCK'
-- Exactly one row has status 'CHECKED' and reports how many preconditions ran. A SILENT ZERO-ROW
-- RESULT IS NOT A PASS — it means the query did not run, and that is a stop. Every other row is
-- either a 'BLOCK' naming a precondition that must be reconciled by an owner-run, audited change
-- BEFORE the migration is applied, or an 'INFO' row carrying something the operator should read
-- but which does not stop the deploy.
--
-- Nothing here repairs anything. A preflight that fixes its own preconditions with an UPDATE is a
-- preflight that hides them.
--
-- Read-only: pure SELECTs, no DDL, no DML. Runs inside a server-enforced read-only transaction,
-- so any write would fail with 25006 regardless of what this file contains.

WITH
-- ── BASELINE ────────────────────────────────────────────────────────────────────────────────────
-- The ledger is asserted, never assumed. At STOP 1 the working assumption was that Phase 6 had
-- applied nothing; the owner corrected it (`20261115000000_phase6_relaunch_partial_unique` IS
-- applied, finished 2026-09-14, applied_steps_count 1, 339ms). Asserting the baseline here is why
-- that correction cost a sentence rather than a failed deploy.
--
-- A migration counts as applied when it FINISHED and was not rolled back. A name carrying BOTH a
-- rolled-back row and a successful one is RETRY HISTORY, not a failure — Prisma appends a row per
-- attempt. That is why this counts DISTINCT names over successful rows rather than counting rows.
applied AS (
  SELECT DISTINCT migration_name
  FROM _prisma_migrations
  WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
),
-- A name with a rolled-back attempt and NO success is a genuinely failed migration. `migrate
-- deploy` refuses to run while one exists, so it is a BLOCK rather than a surprise at deploy time.
failed AS (
  SELECT m.migration_name
  FROM _prisma_migrations m
  WHERE m.rolled_back_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM applied a WHERE a.migration_name = m.migration_name)
),
retry_history AS (
  SELECT DISTINCT m.migration_name
  FROM _prisma_migrations m
  JOIN applied a ON a.migration_name = m.migration_name
  WHERE m.rolled_back_at IS NOT NULL
),
-- ── PRECONDITIONS FOR 20261116000000_financing_status_default ───────────────────────────────────
-- The statement is `ALTER TABLE "financing" ALTER COLUMN "status" SET DEFAULT 'NOT_STARTED'`.
-- It needs: the table, the column, the enum type, and the label. A missing label is the only way
-- this statement can fail, and it fails the whole transaction.
financing_target AS (
  SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'financing') AS tbl,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'financing' AND column_name = 'status') AS col,
    (SELECT count(*) FROM pg_type t
      WHERE t.typname = 'FinancingStatus') AS enum_type,
    (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'FinancingStatus' AND e.enumlabel = 'NOT_STARTED') AS label,
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'financing' AND column_name = 'status') AS current_default,
    (SELECT count(*) FROM financing) AS row_count
),
-- ── PRECONDITIONS FOR 20261116000100_identity_firewall_revocation ───────────────────────────────
-- `ADD COLUMN IF NOT EXISTS` twice. The only precondition is the table; a column that already
-- exists makes the statement a no-op, which is CHECKED, not BLOCK.
firewall_target AS (
  SELECT
    (SELECT count(*) FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'identity_firewall_entries') AS tbl,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'identity_firewall_entries'
        AND column_name IN ('revoked_at','revoked_by')) AS already_present,
    (SELECT count(*) FROM identity_firewall_entries) AS row_count
),
-- ── THE TWO MIGRATIONS MUST NOT ALREADY BE RECORDED ─────────────────────────────────────────────
-- If either is, this deploy is a re-run and `migrate deploy` will skip it. Reported as INFO so an
-- operator re-running after a partial failure sees why nothing applies, rather than as a BLOCK.
already_recorded AS (
  SELECT migration_name FROM applied
  WHERE migration_name IN (
    '20261116000000_financing_status_default',
    '20261116000100_identity_firewall_revocation'
  )
),
blocks AS (
  SELECT 'BLOCK'::text AS status,
         'failed migration in the ledger: ' || migration_name AS detail,
         'prisma migrate deploy refuses to run while a rolled-back migration has no successful '
         || 'attempt. Resolve it with an owner-approved `prisma migrate resolve` first.' AS remedy
  FROM failed

  UNION ALL
  SELECT 'BLOCK',
         'baseline mismatch: ' || (SELECT count(*) FROM applied)::text
           || ' migrations applied, expected 111',
         'The chain this branch was authored against has 111 migrations before Phase 7. A '
         || 'different count means production is not where this package assumes. STOP and '
         || 'reconcile before applying anything.'
  WHERE (SELECT count(*) FROM applied) <> 111

  UNION ALL
  SELECT 'BLOCK',
         'Phase 6 migration 20261115000000_phase6_relaunch_partial_unique is NOT applied',
         'Phase 7 was authored on top of it. Applying Phase 7 against a chain missing it is '
         || 'outside what was proved. STOP.'
  WHERE NOT EXISTS (
    SELECT 1 FROM applied WHERE migration_name = '20261115000000_phase6_relaunch_partial_unique'
  )

  UNION ALL
  SELECT 'BLOCK',
         'financing table or status column missing',
         'ALTER TABLE "financing" ALTER COLUMN "status" cannot run. STOP.'
  FROM financing_target WHERE tbl <> 1 OR col <> 1

  UNION ALL
  SELECT 'BLOCK',
         'FinancingStatus enum or its NOT_STARTED label is missing',
         'SET DEFAULT ''NOT_STARTED'' fails without the label, and Prisma runs the file in one '
         || 'transaction. STOP.'
  FROM financing_target WHERE enum_type <> 1 OR label <> 1

  UNION ALL
  SELECT 'BLOCK',
         'identity_firewall_entries table missing',
         'ADD COLUMN cannot run. It is created by 20261113000000_phase5_sourcing_invitations; if '
         || 'that is applied and this still blocks, production is not where this package assumes. STOP.'
  FROM firewall_target WHERE tbl <> 1
),
infos AS (
  SELECT 'INFO'::text AS status,
         'retry history (not a failure): ' || migration_name AS detail,
         'This name has both a rolled-back attempt and a successful one. Prisma appends a row per '
         || 'attempt; the successful row is what counts.' AS remedy
  FROM retry_history

  UNION ALL
  SELECT 'INFO',
         'already recorded, this deploy will skip it: ' || migration_name,
         'Expected if you are re-running. Nothing will apply for this migration.'
  FROM already_recorded

  UNION ALL
  SELECT 'INFO',
         'financing.status current default is ' || coalesce(current_default, '(none)')
           || ', over ' || row_count::text || ' row(s)',
         'Expected: ''PENDING''::"FinancingStatus" over 0 rows. A default that is already '
         || 'NOT_STARTED makes the statement a no-op, which is fine. A NON-ZERO row count is not a '
         || 'block — the ALTER touches no row — but it contradicts the production state this '
         || 'package was written against, so read it before proceeding.'
  FROM financing_target

  UNION ALL
  SELECT 'INFO',
         'identity_firewall_entries holds ' || row_count::text || ' row(s); '
           || already_present::text || ' of the 2 new columns already exist',
         'Expected: 0 rows, 0 columns present. Both columns are nullable with no default, so any '
         || 'existing row stays valid unchanged and no backfill is needed.'
  FROM firewall_target
)
SELECT status, detail, remedy FROM blocks
UNION ALL
SELECT status, detail, remedy FROM infos
UNION ALL
SELECT 'CHECKED',
       '8 preconditions evaluated: ledger health, baseline count, Phase 6 presence, financing '
       || 'table, financing column, FinancingStatus label, firewall table, firewall columns',
       'PASS if and only if no BLOCK row appears above. No CHECKED row means this query did not '
       || 'run — also a stop.'
ORDER BY 1, 2;
