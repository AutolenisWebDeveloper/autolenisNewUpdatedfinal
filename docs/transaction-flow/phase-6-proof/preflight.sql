-- Phase 6 preflight — run BEFORE `prisma migrate deploy`, and show the COMPLETE result.
--
-- Every row returns CHECKED or BLOCK. One BLOCK stops the run. A MISSING row is also a stop: each
-- assertion emits a row unconditionally rather than returning nothing when it passes.
--
-- Read-only. Run in the shape CLAUDE.md mandates:
--
--   psql "$DIRECT_URL" -X -P pager=off -v ON_ERROR_STOP=1 --single-transaction \
--     -c "SET TRANSACTION READ ONLY" -f docs/transaction-flow/phase-6-proof/preflight.sql
--
-- Every relation named here is in the Prisma chain, so no out-of-chain table can make a statement
-- unparseable and no trailer file is needed.

\pset footer off

-- ── the ledger ──────────────────────────────────────────────────────────────
--
-- APPLIED, not merely RECORDED. Prisma APPENDS a ledger row per attempt rather than replacing, so
-- a migration that timed out and was resolved `--rolled-back` leaves a row behind. Counting rows
-- would BLOCK the very retry that rollback exists to permit — migration 109 timed out twice on
-- 2026-09-13 and applied clean on the third attempt, which is why this database permanently reads
-- 112 rows against 110 distinct migrations.
SELECT 'A1 20261115000000 is not yet APPLIED (a rolled-back attempt is history, not a block)' AS assertion,
       CASE WHEN count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) = 0
            THEN 'CHECKED' ELSE 'BLOCK' END AS verdict,
       count(*)::text || ' row(s), ' ||
       count(*) FILTER (WHERE rolled_back_at IS NOT NULL)::text || ' rolled back, ' ||
       count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)::text || ' applied' AS detail
  FROM _prisma_migrations
 WHERE migration_name = '20261115000000_phase6_relaunch_partial_unique'
UNION ALL
SELECT 'A2 its predecessor 20261114000000 is applied and finished',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' finished row(s)'
  FROM _prisma_migrations
 WHERE migration_name = '20261114000000_invitation_replacement_partial_unique'
   AND finished_at IS NOT NULL AND rolled_back_at IS NULL
UNION ALL
-- STUCK, not merely rolled back. A migration is stuck when it has NO successful row; a rollback
-- sitting beside a success is the retry that fixed it.
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

-- ── the object this migration replaces ──────────────────────────────────────
UNION ALL
SELECT 'A4 auctions_deposit_id_key exists (this migration replaces it)',
       CASE WHEN count(*) = 1 THEN 'CHECKED' ELSE 'BLOCK' END,
       coalesce(max(indexdef), 'ABSENT — nothing to replace; the migration may already be applied')
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'auctions_deposit_id_key'
UNION ALL
SELECT 'A5 neither replacement index exists yet',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' already present'
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexname IN ('auctions_deposit_id_original_key', 'auctions_original_auction_id_key')
UNION ALL
SELECT 'A6 neither relaunch column exists yet',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       count(*)::text || ' already present'
  FROM information_schema.columns
 WHERE table_name = 'auctions' AND column_name IN ('relaunched_at', 'relaunch_count')

-- ── the data precondition the partial index needs ───────────────────────────
UNION ALL
-- THE ONE THAT CAN ACTUALLY STOP THIS RUN. `CREATE UNIQUE INDEX ... WHERE original_auction_id IS
-- NULL` fails with 23505 if any deposit already carries two rows with a NULL parent. Nothing in
-- the codebase has ever written `original_auction_id`, so every existing auction is an original —
-- meaning this is exactly "no deposit has two auctions". Reported, never repaired: two auctions on
-- one $99 is an owner decision about a buyer's money, not a migration's.
SELECT 'A7 no deposit carries more than one auction with a NULL original_auction_id',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       CASE WHEN count(*) = 0 THEN 'none'
            ELSE count(*)::text || ' deposit(s): ' || string_agg(deposit_id, ', ') END
  FROM (
    SELECT deposit_id
      FROM auctions
     WHERE original_auction_id IS NULL
     GROUP BY deposit_id
    HAVING count(*) > 1
  ) dupes
UNION ALL
SELECT 'A8 no two auctions already share one original_auction_id',
       CASE WHEN count(*) = 0 THEN 'CHECKED' ELSE 'BLOCK' END,
       CASE WHEN count(*) = 0 THEN 'none'
            ELSE count(*)::text || ' parent(s) with >1 retry' END
  FROM (
    SELECT original_auction_id
      FROM auctions
     WHERE original_auction_id IS NOT NULL
     GROUP BY original_auction_id
    HAVING count(*) > 1
  ) multi

-- ── context, reported so the run is legible afterwards ──────────────────────
UNION ALL
-- Not a gate. Recorded so the post-deploy numbers can be compared against the before state rather
-- than against memory.
SELECT 'A9 auction census (context, never a block)',
       'CHECKED',
       count(*)::text || ' auctions, ' ||
       count(*) FILTER (WHERE original_auction_id IS NULL)::text || ' original, ' ||
       count(*) FILTER (WHERE original_auction_id IS NOT NULL)::text || ' retry, ' ||
       count(DISTINCT deposit_id)::text || ' distinct deposits'
  FROM auctions
;
