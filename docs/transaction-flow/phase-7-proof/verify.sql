-- Phase 7 POST-DEPLOY verification. Run READ-ONLY against PRODUCTION immediately after
-- `prisma migrate deploy`.
--
-- CONTRACT, the same shape as the preflight:
--     PASS  <=>  no row has status = 'MISSING'
-- Exactly one row has status 'CHECKED'. A silent zero-row result is NOT a pass.
--
-- BOTH HALVES, AND NEITHER ALONE IS SUFFICIENT. This file checks the PHYSICAL SCHEMA (the default
-- actually on the column, the columns actually on the table) AND the LEDGER (`_prisma_migrations`).
-- The two can disagree in both directions and each disagreement means something different:
--   • schema present, ledger absent  -> DDL was applied out of band. The repair is an owner-approved
--                                       `prisma migrate resolve --applied`, never more DDL.
--   • ledger present, schema absent  -> the ledger is lying. Report it; do not "fix" it with DDL.
-- Six migrations once went unrecorded in this project and enum labels came to exist with no ledger
-- row. That is why both halves are here and why a MISSING row is reported rather than repaired.
--
-- Read-only: pure SELECTs, no DDL, no DML.

WITH
expected(migration_name) AS (
  VALUES ('20261116000000_financing_status_default'),
         ('20261116000100_identity_firewall_revocation')
),
-- A migration counts as applied when it FINISHED and was not rolled back. A name carrying both a
-- rolled-back row and a successful one is RETRY HISTORY — Prisma appends a row per attempt.
ledger AS (
  SELECT e.migration_name,
         (SELECT count(*) FROM _prisma_migrations m
           WHERE m.migration_name = e.migration_name
             AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL) AS successes,
         (SELECT count(*) FROM _prisma_migrations m
           WHERE m.migration_name = e.migration_name
             AND m.rolled_back_at IS NOT NULL) AS rollbacks,
         (SELECT max(m.applied_steps_count) FROM _prisma_migrations m
           WHERE m.migration_name = e.migration_name
             AND m.finished_at IS NOT NULL AND m.rolled_back_at IS NULL) AS steps
  FROM expected e
),
physical AS (
  SELECT
    (SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'financing' AND column_name = 'status')
      AS financing_status_default,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'identity_firewall_entries'
        AND column_name = 'revoked_at') AS revoked_at_present,
    (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'identity_firewall_entries'
        AND column_name = 'revoked_by') AS revoked_by_present,
    (SELECT data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'identity_firewall_entries'
        AND column_name = 'revoked_at') AS revoked_at_type,
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'identity_firewall_entries'
        AND column_name = 'revoked_at') AS revoked_at_nullable,
    (SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'identity_firewall_entries'
        AND column_name = 'revoked_by') AS revoked_by_nullable
),
findings AS (
  -- ── LEDGER HALF ───────────────────────────────────────────────────────────────────────────────
  SELECT 'MISSING'::text AS status,
         'ledger: ' || migration_name || ' has no successful row' AS detail,
         'The migration did not record. If the schema half below is PRESENT, this is DDL applied '
         || 'out of band — repair with an owner-approved `prisma migrate resolve --applied`, never '
         || 'with more DDL.' AS remedy
  FROM ledger WHERE successes = 0

  UNION ALL
  SELECT 'PRESENT',
         'ledger: ' || migration_name || ' applied (' || successes::text || ' success, '
           || rollbacks::text || ' rolled-back attempt(s), applied_steps_count '
           || coalesce(steps::text, 'null') || ')',
         CASE WHEN rollbacks > 0
              THEN 'The rolled-back row beside a success is RETRY HISTORY, not a failure.'
              ELSE 'Clean single application.' END
  FROM ledger WHERE successes > 0

  -- ── PHYSICAL HALF ─────────────────────────────────────────────────────────────────────────────
  UNION ALL
  SELECT 'MISSING',
         'schema: financing.status default is '
           || coalesce((SELECT financing_status_default FROM physical), '(none)')
           || ', expected NOT_STARTED',
         'The ALTER did not take. If the ledger half says applied, the ledger is lying — report '
         || 'it, do not reapply DDL by hand.'
  WHERE coalesce((SELECT financing_status_default FROM physical), '') NOT LIKE '%NOT_STARTED%'

  UNION ALL
  SELECT 'PRESENT',
         'schema: financing.status default is '
           || (SELECT financing_status_default FROM physical),
         'A column default changes future inserts only; no row was touched.'
  WHERE coalesce((SELECT financing_status_default FROM physical), '') LIKE '%NOT_STARTED%'

  UNION ALL
  SELECT 'MISSING',
         'schema: identity_firewall_entries.revoked_at is absent',
         'dealerIdentityVisible() reads this column on every dealer surface and fails CLOSED on '
         || '42703 — safe, but every winning dealership loses the buyer''s details until it lands.'
  WHERE (SELECT revoked_at_present FROM physical) <> 1

  UNION ALL
  SELECT 'MISSING',
         'schema: identity_firewall_entries.revoked_by is absent',
         'Same predicate, same fail-closed consequence.'
  WHERE (SELECT revoked_by_present FROM physical) <> 1

  UNION ALL
  SELECT 'PRESENT',
         'schema: identity_firewall_entries.revoked_at ' || (SELECT revoked_at_type FROM physical)
           || ', nullable=' || (SELECT revoked_at_nullable FROM physical)
           || '; revoked_by nullable=' || (SELECT revoked_by_nullable FROM physical),
         'Both nullable with no default, so every pre-existing row is valid unchanged and '
         || 'revoked_at IS NULL reads as "not revoked" without a backfill.'
  WHERE (SELECT revoked_at_present FROM physical) = 1
    AND (SELECT revoked_by_present FROM physical) = 1
)
SELECT status, detail, remedy FROM findings
UNION ALL
SELECT 'CHECKED',
       '2 migrations verified in BOTH halves: physical schema and _prisma_migrations',
       'PASS if and only if no MISSING row appears above. No CHECKED row means this query did not '
       || 'run — also a stop. A MISSING row is REPORTED, never repaired with DDL: the repair is a '
       || 'new forward migration or an owner-approved `migrate resolve`.'
ORDER BY 1, 2;
