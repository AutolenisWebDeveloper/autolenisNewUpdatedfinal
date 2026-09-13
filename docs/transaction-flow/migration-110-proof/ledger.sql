-- Migration 110 verification — the LEDGER half. Run AFTER `prisma migrate deploy`.
--
-- Emits exactly one row per assertion, so an EMPTY result is distinguishable from a query that did
-- not run. An absent ledger row is the failure mode that looks most like success.
--
-- Read-only. Same mandated shape as the preflight.

\pset footer off

SELECT migration_name, started_at, finished_at, rolled_back_at, applied_steps_count,
       CASE WHEN rolled_back_at IS NOT NULL THEN 'retry attempt, rolled back — history, not a failure'
            WHEN finished_at IS NULL         THEN 'REPORT — started and never finished'
            WHEN applied_steps_count < 1     THEN 'REPORT — recorded with zero applied steps'
            ELSE 'OK' END AS verdict
  FROM _prisma_migrations
 WHERE migration_name = '20261114000000_invitation_replacement_partial_unique'
 ORDER BY started_at;

-- ONE APPLIED ROW, any number of rolled-back attempts beside it. Prisma appends a row per attempt,
-- so "expected 1 row" was wrong the moment a timeout happened: migration 109 holds 3 rows for one
-- migration. What must be exactly one is the FINISHED, non-rolled-back row.
SELECT CASE WHEN applied = 1 THEN 'OK — one applied row' ||
                 CASE WHEN rolled_back > 0
                      THEN ' (plus ' || rolled_back::text || ' rolled-back retry attempt(s))'
                      ELSE '' END
            WHEN applied = 0 THEN 'REPORT — NOT APPLIED: ' || total::text || ' row(s), none finished'
            ELSE 'REPORT — ' || applied::text || ' applied rows (expected exactly 1)' END
         AS ledger_row_presence
  FROM (
    SELECT count(*) AS total,
           count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS applied,
           count(*) FILTER (WHERE rolled_back_at IS NOT NULL) AS rolled_back
      FROM _prisma_migrations
     WHERE migration_name = '20261114000000_invitation_replacement_partial_unique'
  ) c;

-- The tail, so the ordering is visible rather than inferred. 110 must be last and its predecessor
-- must be 20261113000000.
SELECT migration_name, finished_at, applied_steps_count
  FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 4;

-- `migrate deploy` refuses to run while a failed row stands, so this also gates the NEXT deploy.
-- STUCK, not merely rolled back — see preflight A3. A name with a success plus rolled-back
-- attempts is the retry that fixed it, and flagging it would make this query read REPORT forever on
-- this database.
SELECT CASE WHEN count(*) = 0 THEN 'OK — every migration has a finished, non-rolled-back row'
            ELSE 'REPORT — ' || count(*)::text || ' stuck: ' || string_agg(migration_name, ', ') END
         AS chain_health
  FROM (
    SELECT migration_name FROM _prisma_migrations
     GROUP BY migration_name
    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
  ) stuck;
