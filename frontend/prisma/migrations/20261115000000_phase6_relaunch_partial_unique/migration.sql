-- Migration 111 — let ONE relaunch auction share its original's deposit (§13-D39).
--
-- WHY. §8c allows Operations one relaunch of a zero-offer auction "without a second $99". The
-- deposit is the thing that must be shared, and `auctions.deposit_id` carries an ABSOLUTE unique
-- index, so a relaunch cannot be written at all today:
--
--   auctions_deposit_id_key  ON "auctions" ("deposit_id")
--     -- 20260423003354_init:768. A bare UNIQUE INDEX, not a table constraint, which is why the
--        drop below is `DROP INDEX` and not `ALTER TABLE ... DROP CONSTRAINT`.
--
-- `original_auction_id` and its self-FK have existed since that same init migration and have never
-- had a writer (verified: zero references across lib/, app/, components/, scripts/, tests/).
-- Production holds 7 auctions, all CLOSED, all with `original_auction_id` NULL, and zero deposits
-- carrying more than one auction — so this migration reconciles no existing data.
--
-- THE RULING. §13-D39, ruled 2026-09-13: adopt the retry auction referencing the same deposit
-- through `original_auction_id`, with the unique relaxed to a partial index. Reopening the same
-- auction row was rejected, and the schema shows why: `auction_invitations_auction_rooftop_active_key`
-- is `(auction_id, rooftop_id) WHERE status <> 'REPLACED'`, so a relaunch inviting the same rooftop
-- under the same auction_id would have to mark the first invitation REPLACED — overwriting exactly
-- the record of what was invited when. The same ruling leaves `OfferStatus.NOT_SELECTED` WITHHELD
-- (§8.1a L794-799); non-selected offers keep taking `DECLINED`, and `verify.sql` still asserts the
-- label absent.
--
-- THE PREDICATE, AND WHY IT IS `original_auction_id IS NULL`. The guarantee narrows from "at most
-- one auction per deposit" to "at most one ORIGINAL auction per deposit". A relaunch carries a
-- non-NULL `original_auction_id` and is therefore outside the index.
--
--   `relaunched_at IS NULL` was considered and is WRONG: the original before it has been relaunched
--   and the relaunch itself BOTH carry NULL, so they would collide and the feature could never be
--   written. The predicate has to key on the thing that distinguishes the two rows, which is
--   parentage, not timing.
--
-- WHAT THIS DELIBERATELY PRESERVES. Two places state the absolute unique as the only protection
-- against `SOURCING_CASE_REPLACES_AUCTION_LAUNCH` (§13-D52, still ahead) and the legacy webhook
-- path both creating an auction for one deposit:
--   app/api/cron/coverage-hold-reconcile/route.ts:42-45 and lib/services/auction/deposit-activation.service.ts.
-- Both paths write a FRESH auction, i.e. `original_auction_id` NULL, so both remain inside this
-- index and still collide. The double-run guard survives D39 intact. This is the load-bearing
-- reason for the predicate above and not merely a consequence of it.
--
-- THE SECOND INDEX. `auctions_original_auction_id_key` enforces "one relaunch per original"
-- declaratively, so §8c's "one relaunch" does not rest on an application counter alone.
-- `relaunch_count` is the readable form of the same fact and is checked in code; the index is what
-- makes a concurrent double-relaunch impossible rather than unlikely.
--
-- ORDER. Both replacement indexes are created BEFORE the absolute one is dropped. Prisma runs a
-- migration inside one transaction, so there is no window in which the table is unprotected, and a
-- mid-transaction failure leaves the original index standing.
--
-- LOCKING. `CREATE UNIQUE INDEX` without CONCURRENTLY takes ACCESS EXCLUSIVE. `auctions` holds 7
-- rows in production, so the lock is held for microseconds. CONCURRENTLY cannot run inside a
-- transaction block, and the create-before-drop ordering is what makes this safe.
--
-- SCHEMA. `schema.prisma` loses `@unique` on `Auction.depositId` because the Prisma DSL cannot
-- express a `WHERE`. That change is NOT cosmetic: Prisma refuses to parse a one-to-one relation
-- whose defining field is not unique, so `Deposit.auction Auction?` becomes `Deposit.auctions
-- Auction[]` in the same edit. Both indexes live only in SQL, the position every partial index in
-- this schema already holds. Measured on a chain-built database: this adds ZERO structural drift
-- statements (`prisma migrate diff` emits nothing for partial indexes), so
-- `prisma/drift-baseline.json` stays pinned at 344 and needs no entry.
--
-- ORDERING AGAINST THE APPLICATION DEPLOY — ASYMMETRIC, NOT "EITHER ORDER". The migration must land
-- FIRST. Deploying the application first removes `depositId` from Prisma's generated
-- `AuctionWhereUniqueInput` while the absolute index still stands, so the relaunch writer would be
-- refused by the constraint it was written to work around. Migration-first is harmless: nothing
-- writes `relaunched_at` or a non-NULL `original_auction_id` until the application ships.

ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "relaunched_at" TIMESTAMP(3);
ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "relaunch_count" INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "auctions_deposit_id_original_key"
  ON "auctions" ("deposit_id")
  WHERE "original_auction_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "auctions_original_auction_id_key"
  ON "auctions" ("original_auction_id")
  WHERE "original_auction_id" IS NOT NULL;

DROP INDEX IF EXISTS "auctions_deposit_id_key";
