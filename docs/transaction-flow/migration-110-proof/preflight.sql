-- Migration 110 preflight — run BEFORE `prisma migrate deploy`, and show the COMPLETE result.
--
-- Every row returns CHECKED or BLOCK. One BLOCK stops the run. A MISSING row is also a stop: each
-- assertion emits a row unconditionally rather than returning nothing when it passes.
--
-- Read-only. Run in the shape CLAUDE.md mandates:
--
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/migration-110-proof/preflight.sql
--
-- Every relation named here is in the Prisma chain, so unlike the Phase 5 preflight there is no
-- out-of-chain table to make a statement unparseable (finding 27). Nothing needs a trailer file.

\pset footer off

-- APPLIED, not merely RECORDED. Prisma APPENDS a ledger row per attempt rather than replacing,
-- so a migration that timed out and was resolved `--rolled-back` leaves a row behind. Counting rows
-- here would BLOCK the very retry that rollback exists to permit — which is not hypothetical:
-- migration 109 timed out twice (02:54 and 03:01 on 2026-09-13, each waiting out the 2-minute
-- statement_timeout behind an idle-in-transaction preflight session) and applied clean on the third
-- attempt, leaving 3 rows for one migration.
SELECT 'A1 20261114000000 is not yet APPLIED (a rolled-back attempt is history, not a block)' AS assertion,
       CASE WHEN count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict,
       count(*)::text || ' row(s), ' ||
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text || ' rolled back, ' ||
       count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || ' applied' AS detail
  FROM _prisma_migrations
 WHERE migration_name = '20261114000000_invitation_replacement_partial_unique'
UNION ALL
SELECT 'A2 its predecessor 20261113000000 is applied and finished',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' finished row(s)'
  FROM _prisma_migrations
 WHERE migration_name = '20261113000000_phase5_sourcing_invitations'
   AND finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL
-- STUCK, not merely rolled back. The old wording BLOCKED on any rolled-back row anywhere, which
-- on this database is two rows belonging to a migration that subsequently applied cleanly — so it
-- would have stopped this run on a condition that is healthy. A migration is stuck when it has NO
-- successful row; a rollback sitting beside a success is the retry that fixed it.
SELECT 'A3 no migration is STUCK — every name has a finished, non-rolled-back row',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       CASE WHEN count(*) = 0 THEN 'none stuck'
            ELSE count(*)::text || ' stuck: ' || string_agg(migration_name, ', ') END
  FROM (
    SELECT migration_name
      FROM _prisma_migrations
     GROUP BY migration_name
    HAVING count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
  ) stuck
UNION ALL
-- ── THE ONLY DATA-DEPENDENT BLOCKS. `CREATE UNIQUE INDEX` fails on an existing duplicate, and
-- these are the exact pairs the two new partial indexes will cover. If either is non-zero the
-- migration aborts mid-transaction, so it is reported here rather than discovered there.
SELECT 'B1 no duplicate (auction_id, rooftop_id) among NON-REPLACED invitations',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' colliding pair(s)'
  FROM (
    SELECT auction_id, rooftop_id FROM auction_invitations
     WHERE rooftop_id IS NOT NULL AND status <> 'REPLACED'
     GROUP BY 1, 2 HAVING count(*) > 1
  ) dup_rooftop
UNION ALL
SELECT 'B2 no duplicate (auction_id, dealer_id) among NON-REPLACED invitations',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' colliding pair(s)'
  FROM (
    SELECT auction_id, dealer_id FROM auction_invitations
     WHERE dealer_id IS NOT NULL AND status <> 'REPLACED'
     GROUP BY 1, 2 HAVING count(*) > 1
  ) dup_dealer
UNION ALL
-- ── C. Figures, not gates. ────────────────────────────────────────────────
SELECT 'C1 the two indexes this migration supersedes are present',
       'CHECKED',
       coalesce(string_agg(indexname, ', ' ORDER BY indexname), 'NEITHER — already superseded?')
  FROM pg_indexes
 WHERE tablename = 'auction_invitations'
   AND indexname IN ('auction_invitations_auction_rooftop_key',
                     'auction_invitations_auction_id_dealer_id_key')
UNION ALL
SELECT 'C2 auction_invitations row count (the ACCESS EXCLUSIVE lock duration)',
       'CHECKED', count(*)::text || ' row(s)'
  FROM auction_invitations
UNION ALL
SELECT 'C3 invitations already REPLACED (the rows the new predicate will exclude)',
       'CHECKED', count(*)::text || ' row(s)'
  FROM auction_invitations WHERE status = 'REPLACED'
UNION ALL
SELECT 'C4 auction_invitations by status — ' || status::text,
       'CHECKED', count(*)::text || ' row(s)'
  FROM auction_invitations GROUP BY status
UNION ALL
SELECT 'C4 auction_invitations by status — (none)', 'CHECKED', 'the table is empty'
 WHERE NOT EXISTS (SELECT 1 FROM auction_invitations)
UNION ALL
-- THE LEDGER ROW COUNT IS NOT THE MIGRATION COUNT once any retry has happened, and on this
-- database it never will be again. Stated as a figure so nobody re-derives the wrong equality:
-- 111 rows / 109 distinct / 2 rolled back as of 2026-09-13.
SELECT 'C5 ledger rows vs distinct migrations (these DIVERGE after a retry)',
       'CHECKED',
       count(*)::text || ' rows, ' || count(DISTINCT migration_name)::text || ' distinct, ' ||
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text || ' rolled back'
  FROM _prisma_migrations
 ORDER BY 1
;
