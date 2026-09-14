-- Phase 6 migration verification — the PHYSICAL half.
--
-- One row per object 20261115000000_phase6_relaunch_partial_unique is expected to produce, plus
-- the one object it must REMOVE. Every row reports PRESENT or MISSING; a single MISSING row is a
-- stop.
--
-- This file asserts the physical schema ONLY. `_prisma_migrations` is a separate question and
-- neither half is sufficient alone — see ledger.sql in this directory.
--
-- Read-only: every statement is a SELECT. Safe inside `-c "SET TRANSACTION READ ONLY"`.

\pset footer off

-- ── 1. the two relaunch columns ─────────────────────────────────────────────
SELECT 'auctions.relaunched_at'                                  AS object,
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END   AS state,
       coalesce(max(data_type), '-')                              AS detail
  FROM information_schema.columns
 WHERE table_name = 'auctions' AND column_name = 'relaunched_at'
UNION ALL
-- NOT NULL with a default of 0: every existing auction has used zero relaunches, which is a fact
-- we can assert rather than a value we are guessing, so DEFAULT is correct here where it was
-- wrong for circumvention_attempts.after_paid_auction in Phase 5.
SELECT 'auctions.relaunch_count',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(data_type || ' null=' || is_nullable || ' default=' || coalesce(column_default, '-')), '-')
  FROM information_schema.columns
 WHERE table_name = 'auctions' AND column_name = 'relaunch_count'
UNION ALL
SELECT 'auctions.relaunch_count is NOT NULL DEFAULT 0',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       '-'
  FROM information_schema.columns
 WHERE table_name = 'auctions' AND column_name = 'relaunch_count'
   AND is_nullable = 'NO' AND column_default LIKE '0%'

-- ── 2. the partial unique that replaces the absolute one ────────────────────
UNION ALL
SELECT 'index auctions_deposit_id_original_key',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'auctions_deposit_id_original_key'
UNION ALL
-- The PREDICATE is the ruling. `original_auction_id IS NULL` is what keeps one original per
-- deposit while exempting the retry; `relaunched_at IS NULL` would have collided (the original
-- before relaunch and the relaunch itself both carry NULL) and is asserted absent by implication.
SELECT 'auctions_deposit_id_original_key predicate is (original_auction_id IS NULL)',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       '-'
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'auctions_deposit_id_original_key'
   AND indexdef ILIKE '%WHERE (original_auction_id IS NULL)%'
UNION ALL
SELECT 'index auctions_original_auction_id_key',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), '-')
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'auctions_original_auction_id_key'

-- ── 3. the absolute unique must be GONE ─────────────────────────────────────
UNION ALL
-- Inverted assertion: PRESENT here means "correctly absent". Stated this way so a MISSING row is
-- always the stop signal, whichever direction the object was supposed to move.
SELECT 'index auctions_deposit_id_key is REMOVED',
       CASE WHEN count(*) = 0 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(indexdef), 'absent')
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'auctions_deposit_id_key'

-- ── 4. what this migration must NOT have touched ────────────────────────────
UNION ALL
-- `original_auction_id` and its self-FK predate this wave (init, 2026-04). If either moved, the
-- migration did more than it claims.
SELECT 'auctions.original_auction_id still present (predates this wave)',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       '-'
  FROM information_schema.columns
 WHERE table_name = 'auctions' AND column_name = 'original_auction_id'
UNION ALL
SELECT 'FK auctions_original_auction_id_fkey untouched',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       '-'
  FROM pg_constraint
 WHERE conname = 'auctions_original_auction_id_fkey'
UNION ALL
-- §8.1a L794-799: the D39 ruling explicitly did NOT add this label. verify.sql asserted it absent
-- for Phase 1 and must keep doing so, or the omission stops being a decision.
SELECT 'OfferStatus.NOT_SELECTED still WITHHELD',
       CASE WHEN count(*) = 0 THEN 'PRESENT' ELSE 'MISSING' END,
       '-'
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
 WHERE t.typname = 'OfferStatus' AND e.enumlabel = 'NOT_SELECTED'
UNION ALL
-- Phase 1's one-live-offer index is what Phase 6's candidate binding finally makes bite. It is not
-- this migration's to change, so it must be byte-identical.
SELECT 'offers_one_live_per_rooftop_candidate_key untouched',
       CASE WHEN count(*) = 1 THEN 'PRESENT' ELSE 'MISSING' END,
       '-'
  FROM pg_indexes
 WHERE schemaname = 'public' AND indexname = 'offers_one_live_per_rooftop_candidate_key'
   AND indexdef ILIKE '%WHERE (status = ''SUBMITTED''%'

-- ── 5. no data to reconcile ─────────────────────────────────────────────────
UNION ALL
-- The precondition for the rollback, asserted forward as well: if any deposit already carried two
-- auctions the partial index could not have been created, so this is really a statement that the
-- index creation proves. Kept explicit because the rollback depends on the same fact.
SELECT 'no deposit carries more than one ORIGINAL auction',
       CASE WHEN count(*) = 0 THEN 'PRESENT' ELSE 'MISSING' END,
       coalesce(max(deposit_id), '-')
  FROM (
    SELECT deposit_id
      FROM auctions
     WHERE original_auction_id IS NULL
     GROUP BY deposit_id
    HAVING count(*) > 1
  ) dupes
;
