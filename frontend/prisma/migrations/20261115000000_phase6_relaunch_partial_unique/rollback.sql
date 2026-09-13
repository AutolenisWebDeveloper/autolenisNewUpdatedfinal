-- Rollback for migration 111 — restore the absolute unique on auctions.deposit_id.
--
-- SAFE ONLY WHILE NO RELAUNCH HAS HAPPENED. Restoring the status-blind index will FAIL with
-- 23505 the moment any deposit carries two auctions. Check first, and do not force it:
--
--   SELECT deposit_id, count(*) AS n
--     FROM auctions
--    GROUP BY deposit_id
--   HAVING count(*) > 1;
--
-- Zero rows -> this rollback applies cleanly. Any row -> STOP and report: a relaunch exists, and
-- reverting the index would require deciding which auction to destroy. That is an owner decision
-- about a buyer's paid $99, never a migration's.
--
-- At the time of writing, production holds 7 auctions across 7 deposits, all with
-- `original_auction_id` NULL, so the query above returns nothing.
--
-- The two columns are deliberately LEFT IN PLACE. Dropping `relaunched_at` / `relaunch_count`
-- would destroy the record of which auctions were relaunched and how often — the audit this
-- ruling exists to preserve — and an additive nullable column plus a defaulted integer cost
-- nothing to leave behind. A re-apply of the forward migration is a no-op against them.
--
-- ORDER. Recreate the absolute index BEFORE dropping the partial ones, for the same reason the
-- forward migration creates before dropping: no unprotected window.

CREATE UNIQUE INDEX IF NOT EXISTS "auctions_deposit_id_key"
  ON "auctions" ("deposit_id");

DROP INDEX IF EXISTS "auctions_deposit_id_original_key";
DROP INDEX IF EXISTS "auctions_original_auction_id_key";
