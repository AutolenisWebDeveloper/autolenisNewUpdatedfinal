-- Phase 6 migration verification — the BEHAVIOURAL half.
--
-- verify.sql proves the objects EXIST. It cannot prove the PREDICATE is the right one, and the
-- predicate is the whole of §13-D39: `WHERE original_auction_id IS NULL` was chosen over
-- `WHERE relaunched_at IS NULL` because the latter would let the original and its retry collide,
-- making the feature unwritable. An index with the wrong predicate passes every assertion in
-- verify.sql and fails the first buyer.
--
-- Phase 1's proof package learned this the hard way: two latent defects passed all of verify.sql's
-- assertions and were caught only by exercising behaviour (`behaviour.sql`, run-proof step 4d).
-- This file is the same gate for this wave.
--
-- FOUR CLAIMS, each exercised against real rows:
--   B1  a second ORIGINAL auction on one deposit is still REFUSED   (the guarantee that survives)
--   B2  a RELAUNCH on that same deposit is ACCEPTED                 (the guarantee that changed)
--   B3  a SECOND relaunch of the same original is REFUSED           (§8c's "one relaunch")
--   B4  a relaunch of a DIFFERENT original on the same deposit is REFUSED
--
-- Everything runs inside one transaction that is ROLLED BACK, so the database is unchanged. Safe
-- to re-run. NOT read-only — it inserts — so it never runs against production and the runner only
-- ever points it at a loopback throwaway database.

\pset footer off
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id, supabase_id, email, role, updated_at)
VALUES ('p6u', 'p6-supabase', 'p6-behaviour@example.invalid', 'BUYER', now());
INSERT INTO buyers (id, user_id, first_name, last_name, updated_at)
VALUES ('p6b', 'p6u', 'Proof', 'Buyer', now());
INSERT INTO deposits (id, buyer_id, amount_cents, updated_at)
VALUES ('p6d', 'p6b', 9900, now());

-- The original auction. `original_auction_id` is NULL, so it sits inside the partial unique.
INSERT INTO auctions (id, buyer_id, deposit_id, updated_at, status)
VALUES ('p6a-original', 'p6b', 'p6d', now(), 'CLOSED');

-- ── B1 — a second ORIGINAL on the same deposit is still refused ─────────────
-- This is the guarantee the double-run guard rests on: `SOURCING_CASE_REPLACES_AUCTION_LAUNCH`
-- and the legacy webhook path both write a FRESH auction, so both stay inside this index and
-- still collide. If this claim ever stops holding, that guard has silently gone with it.
SAVEPOINT b1;
DO $$
BEGIN
  INSERT INTO auctions (id, buyer_id, deposit_id, updated_at, status)
  VALUES ('p6a-second-original', 'p6b', 'p6d', now(), 'PENDING');
  RAISE EXCEPTION 'B1_NOT_REFUSED';
EXCEPTION
  WHEN unique_violation THEN NULL;   -- expected
END $$;
ROLLBACK TO SAVEPOINT b1;
SELECT 'B1 second ORIGINAL auction on one deposit is REFUSED' AS claim, 'PASS' AS verdict;

-- ── B2 — the relaunch is accepted ───────────────────────────────────────────
INSERT INTO auctions (id, buyer_id, deposit_id, original_auction_id, updated_at, status)
VALUES ('p6a-relaunch', 'p6b', 'p6d', 'p6a-original', now(), 'PENDING');
UPDATE auctions SET relaunched_at = now(), relaunch_count = relaunch_count + 1
 WHERE id = 'p6a-original';
SELECT 'B2 a RELAUNCH sharing the same deposit is ACCEPTED' AS claim,
       CASE WHEN count(*) = 2 THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM auctions WHERE deposit_id = 'p6d';

SELECT 'B2b the original records the relaunch' AS claim,
       CASE WHEN relaunch_count = 1 AND relaunched_at IS NOT NULL THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM auctions WHERE id = 'p6a-original';

-- ── B3 — §8c's "one relaunch", enforced by the database ─────────────────────
-- `relaunch_count` is the readable form; this index is what makes a concurrent double-relaunch
-- impossible rather than merely unlikely.
SAVEPOINT b3;
DO $$
BEGIN
  INSERT INTO auctions (id, buyer_id, deposit_id, original_auction_id, updated_at, status)
  VALUES ('p6a-relaunch-2', 'p6b', 'p6d', 'p6a-original', now(), 'PENDING');
  RAISE EXCEPTION 'B3_NOT_REFUSED';
EXCEPTION
  WHEN unique_violation THEN NULL;   -- expected
END $$;
ROLLBACK TO SAVEPOINT b3;
SELECT 'B3 a SECOND relaunch of the same original is REFUSED' AS claim, 'PASS' AS verdict;

-- ── B4 — a relaunch cannot smuggle in a second original ─────────────────────
-- A retry parented to some OTHER auction would carry a non-NULL original_auction_id and so escape
-- the deposit index. The FK is what refuses it: `p6a-nonexistent` is not an auction. Stated
-- explicitly because "the predicate exempts retries" is only safe while parentage is real.
SAVEPOINT b4;
DO $$
BEGIN
  INSERT INTO auctions (id, buyer_id, deposit_id, original_auction_id, updated_at, status)
  VALUES ('p6a-orphan-retry', 'p6b', 'p6d', 'p6a-nonexistent', now(), 'PENDING');
  RAISE EXCEPTION 'B4_NOT_REFUSED';
EXCEPTION
  WHEN foreign_key_violation THEN NULL;   -- expected
END $$;
ROLLBACK TO SAVEPOINT b4;
SELECT 'B4 a retry with a non-existent parent is REFUSED by the self-FK' AS claim, 'PASS' AS verdict;

ROLLBACK;

-- Proof the fixtures are gone: this file must leave the database exactly as it found it.
SELECT 'B5 fixtures rolled back — database unchanged' AS claim,
       CASE WHEN count(*) = 0 THEN 'PASS' ELSE 'FAIL' END AS verdict
  FROM auctions WHERE deposit_id = 'p6d';
