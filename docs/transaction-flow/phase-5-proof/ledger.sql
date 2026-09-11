-- Phase 5 migration verification — the LEDGER half.
--
-- CLAUDE.md requires BOTH halves after any `migrate deploy` and says neither alone is
-- sufficient: the physical schema (verify.sql) and `_prisma_migrations`. The reason is
-- §8.2's own history — six migrations went unrecorded and enum labels came to exist with
-- no ledger row, so a correct physical schema proves nothing about whether Prisma knows
-- it is correct. A schema that is right with an absent ledger row will be re-applied on
-- the next deploy; a ledger row with a missing object is a silent lie.
--
-- An absent row, or a row with `finished_at` NULL or `rolled_back_at` set, is REPORTED —
-- never repaired with DDL. The repair is a new forward migration or an owner-approved
-- `prisma migrate resolve`.
--
-- Read-only. Run inside the same read-only transaction shape as preflight.sql.

\pset footer off

-- The row this deploy must have written.
SELECT migration_name,
       started_at,
       finished_at,
       rolled_back_at,
       applied_steps_count,
       CASE
         WHEN finished_at IS NULL       THEN 'REPORT — started and never finished'
         WHEN rolled_back_at IS NOT NULL THEN 'REPORT — rolled back'
         WHEN applied_steps_count < 1   THEN 'REPORT — recorded with zero applied steps'
         ELSE 'OK'
       END AS verdict
  FROM _prisma_migrations
 WHERE migration_name = '20261113000000_phase5_sourcing_invitations';

-- Emits exactly one row, so an EMPTY result above is distinguishable from a query that
-- did not run. An absent ledger row is the failure mode that looks most like success.
SELECT CASE WHEN count(*) = 1 THEN 'OK — one ledger row'
            WHEN count(*) = 0 THEN 'REPORT — NO LEDGER ROW for 20261113000000'
            ELSE 'REPORT — ' || count(*)::text || ' ledger rows (expected 1)'
       END AS ledger_row_presence
  FROM _prisma_migrations
 WHERE migration_name = '20261113000000_phase5_sourcing_invitations';

-- The tail of the chain, so the ordering is visible rather than inferred. Phase 5 must
-- be last and its predecessor must be 20261112000000.
SELECT migration_name, finished_at, applied_steps_count
  FROM _prisma_migrations
 ORDER BY migration_name DESC
 LIMIT 6;

-- Nothing anywhere in the ledger is unfinished or rolled back. `migrate deploy` refuses
-- to run again while a failed row stands, so this is also the gate on the NEXT deploy.
SELECT CASE WHEN count(*) = 0 THEN 'OK — no unfinished or rolled-back migration'
            ELSE 'REPORT — ' || count(*)::text || ': ' || string_agg(migration_name, ', ')
       END AS chain_health
  FROM _prisma_migrations
 WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
