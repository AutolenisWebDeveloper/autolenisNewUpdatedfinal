-- Migration 110 verification — the LEDGER half. Run AFTER `prisma migrate deploy`.
--
-- Emits exactly one row per assertion, so an EMPTY result is distinguishable from a query that did
-- not run. An absent ledger row is the failure mode that looks most like success.
--
-- Read-only. Same mandated shape as the preflight.

\pset footer off

SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count,
       CASE WHEN finished_at IS NULL        THEN 'REPORT — started and never finished'
            WHEN rolled_back_at IS NOT NULL THEN 'REPORT — rolled back'
            WHEN applied_steps_count < 1    THEN 'REPORT — recorded with zero applied steps'
            ELSE 'OK' END AS verdict
  FROM _prisma_migrations
 WHERE migration_name = '20261114000000_invitation_replacement_partial_unique';

SELECT CASE WHEN count(*) = 1 THEN 'OK — one ledger row'
            WHEN count(*) = 0 THEN 'REPORT — NO LEDGER ROW for 20261114000000'
            ELSE 'REPORT — ' || count(*)::text || ' rows (expected 1)' END AS ledger_row_presence
  FROM _prisma_migrations
 WHERE migration_name = '20261114000000_invitation_replacement_partial_unique';

-- The tail, so the ordering is visible rather than inferred. 110 must be last and its predecessor
-- must be 20261113000000.
SELECT migration_name, finished_at, applied_steps_count
  FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 4;

-- `migrate deploy` refuses to run while a failed row stands, so this also gates the NEXT deploy.
SELECT CASE WHEN count(*) = 0 THEN 'OK — no unfinished or rolled-back migration'
            ELSE 'REPORT — ' || count(*)::text || ': ' || string_agg(migration_name, ', ') END AS chain_health
  FROM _prisma_migrations
 WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
