-- Migration 110 preflight — run BEFORE `prisma migrate deploy`, and show the COMPLETE result.
--
-- Every row returns CHECKED or BLOCK. One BLOCK stops the run. A MISSING row is also a stop: each
-- assertion emits a row unconditionally rather than returning nothing when it passes.
--
-- Read-only. Run in the shape CLAUDE.md mandates:
--
--   psql "$DIRECT_URL" -X -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/migration-110-proof/preflight.sql
--
-- Every relation named here is in the Prisma chain, so unlike the Phase 5 preflight there is no
-- out-of-chain table to make a statement unparseable (finding 27). Nothing needs a trailer file.

\pset footer off

SELECT 'A1 20261114000000 is NOT yet recorded' AS assertion,
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END AS verdict,
       count(*)::text || ' ledger row(s)' AS detail
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
SELECT 'A3 no unfinished or rolled-back migration anywhere in the ledger',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ': ' || coalesce(string_agg(migration_name, ', '), 'none')
  FROM _prisma_migrations
 WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL
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
 ORDER BY 1
;
