-- Phase 6 migration verification — the LEDGER half.
--
-- CLAUDE.md requires BOTH halves after any `migrate deploy` and says neither alone is sufficient:
-- the physical schema (verify.sql) and `_prisma_migrations`. The reason is §8.2's own history —
-- six migrations went unrecorded and enum labels came to exist with no ledger row, so a correct
-- physical schema proves nothing about whether Prisma knows it is correct. A schema that is right
-- with an absent ledger row will be re-applied on the next deploy; a ledger row with a missing
-- object is a silent lie.
--
-- An absent row, or a row with `finished_at` NULL or `rolled_back_at` set, is REPORTED — never
-- repaired with DDL. The repair is a new forward migration or an owner-approved
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
         WHEN finished_at IS NULL        THEN 'REPORT — started and never finished'
         WHEN rolled_back_at IS NOT NULL THEN 'REPORT — rolled back'
         WHEN applied_steps_count < 1    THEN 'REPORT — recorded with zero applied steps'
         ELSE 'OK'
       END AS verdict
  FROM _prisma_migrations
 WHERE migration_name = '20261115000000_phase6_relaunch_partial_unique'
 ORDER BY started_at;

-- Exactly one APPLIED row for this migration. More than one applied row would mean the SQL ran
-- twice; zero means `migrate deploy` did not record it even if the objects exist.
SELECT 'applied rows for 20261115000000' AS assertion,
       count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text AS applied,
       CASE WHEN count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 1
            THEN 'OK' ELSE 'REPORT' END AS verdict
  FROM _prisma_migrations
 WHERE migration_name = '20261115000000_phase6_relaunch_partial_unique';

-- The chain as a whole. Counted the way migration 110's preflight was rewritten to count: a
-- rolled-back row sitting beside a success is retry history, not a fault. On production this reads
-- 112 rows against 110 distinct names BEFORE this migration, and 113 against 111 after it.
SELECT 'chain totals' AS assertion,
       count(*)::text                              AS ledger_rows,
       count(DISTINCT migration_name)::text        AS distinct_migrations,
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text AS rolled_back_rows
  FROM _prisma_migrations;

-- No migration is STUCK — every name has a finished, non-rolled-back row.
SELECT 'stuck migrations' AS assertion,
       CASE WHEN count(*) = 0 THEN 'none' ELSE string_agg(migration_name, ', ') END AS detail,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'REPORT' END AS verdict
  FROM (
    SELECT migration_name
      FROM _prisma_migrations
     GROUP BY migration_name
    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
  ) stuck;
