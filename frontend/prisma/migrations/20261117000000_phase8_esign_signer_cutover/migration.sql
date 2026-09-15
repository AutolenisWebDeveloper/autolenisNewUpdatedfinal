-- Migration 114 — the e-sign signer cutover (§13-D30). Phase 8, Stage 13/14c.
--
-- WHAT THIS DROPS, AND WHY THAT IS THE WHOLE MIGRATION.
--
--   e_sign_envelopes_deal_id_key  UNIQUE ("deal_id")
--     -- 20260423003354_init:783. A bare UNIQUE INDEX, not a table constraint, which is why this
--        is `DROP INDEX` and not `ALTER TABLE ... DROP CONSTRAINT`.
--
-- Stage 13/14c requires that "the co-buyer signs when named as a required signer". A co-buyer
-- signature is a second envelope on the same deal — its own consent snapshot, its own IP, user
-- agent and adopted name, because a shared envelope cannot evidence two ceremonies. The absolute
-- unique on `deal_id` forbids that second row, so this index is the one thing standing between the
-- platform and a required signature it cannot collect.
--
-- THE EXPAND HALF ALREADY HAPPENED, IN PHASE 1.
--   20261106000100_transaction_spine_foundation
--     :45-46    CREATE TYPE "ESignSignerKind" AS ENUM ('BUYER','CO_BUYER')
--     :408      ADD COLUMN "signer_kind" "ESignSignerKind" NOT NULL DEFAULT 'BUYER'
--     :409      ADD COLUMN "co_buyer_id" TEXT
--     :1114-15  CREATE UNIQUE INDEX "e_sign_envelopes_deal_id_signer_kind_key" ("deal_id","signer_kind")
--   and its own comment at :1103-1107 hands this drop to "the signatures phase (§8.2 Phase 8),
--   which drops the old constraint once the new one is proven and every writer sets `signer_kind`".
--
-- BACKFILL: NOTHING TO DO, AND THAT IS VERIFIED RATHER THAN ASSUMED. `signer_kind` is
-- NOT NULL DEFAULT 'BUYER', so every row that existed when Phase 1 deployed took 'BUYER' at the
-- moment the column was added — there is no NULL to repair and no writer that could have produced
-- one. The composite index is therefore TODAY EXACTLY AS STRICT as the absolute one it replaces:
-- with every row at 'BUYER', (deal_id, signer_kind) and (deal_id) forbid precisely the same
-- duplicates. Dropping the old index on its own creates no second row and no data break. The
-- break arrives only when the co-buyer writer ships, which is why this migration and that writer
-- are in the same change.
--
-- CORE RULE 11, IN REVERSE — THE THING THAT MAKES THIS MIGRATION DANGEROUS.
--
-- Rule 11 is written for a migration that NARROWS a constraint: existing rows may violate the new
-- rule, so you check before you tighten. This one WIDENS, and widening has the opposite failure
-- mode, which is worse because it is silent:
--
--   AFTER the drop, a deal_id may hold two envelopes. Every `findUnique({where:{dealId}})`, every
--   `include: { eSignEnvelope: ... }`, and every "the envelope is COMPLETED, so the deal is
--   signed" derivation was correct BY CONSTRUCTION and stops being correct — and NOTHING GOES RED,
--   because the old behaviour is still legal with one row.
--
-- The two halves fail in opposite directions, and the asymmetry is the whole reason they ship
-- together:
--
--   SCHEMA WITHOUT DDL  -> LOUD. Removing `@unique` from `ESignEnvelope.dealId` while
--                          `Deal.eSignEnvelope ESignEnvelope?` still declares a to-one relation
--                          fails `prisma validate` outright: "A one-to-one relation must use
--                          unique fields on the defining side." It cannot reach a database.
--
--   DDL WITHOUT SCHEMA  -> SILENT, and this is the one to fear. If this index is dropped while
--                          schema.prisma keeps `@unique`, Prisma carries on emitting a to-one
--                          join and hands back WHICHEVER OF THE TWO ROWS THE PLANNER RETURNS.
--                          Everything compiles. Everything runs. A deal with a buyer envelope and
--                          a co-buyer envelope answers "is this signed?" from an arbitrary one.
--
-- So the DDL alone is not the safe half — it is the dangerous half. This migration and the Prisma
-- schema change ship as ONE unit, and the deploy order is MIGRATION FIRST, APPLICATION SECOND
-- (the reverse of the Phase 1 rule): the composite index is strictly stricter than the absolute
-- one, so a database that has run this migration is safe for an application that has not, while
-- an application that creates a co-buyer envelope against a database that has not would fail with
-- 23505 unique_violation on e_sign_envelopes_deal_id_key.
--
-- WRITERS, ENUMERATED RATHER THAN ASSUMED (this is what makes the ordering provable):
--   There is exactly ONE row creator in the repository — the upsert at
--   lib/services/esign/buyer-signing.service.ts. There is no `prisma.eSignEnvelope.create`
--   anywhere. Before this change no writer set `signer_kind` at all, so every row in existence
--   carries 'BUYER' from the column default.
--
-- IDEMPOTENT. `DROP INDEX IF EXISTS` is a no-op on the second application, which is what CI's
-- migrations job asserts by applying the whole chain twice.
--
-- ROLLBACK. Unlike a guarded "drop what we created", a phase that REMOVES a constraint cannot be
-- reverted by dropping anything — the revert has to RECREATE it. rollback.sql carries that
-- statement, with the precondition that makes it safe, and the proof harness exercises it in both
-- directions rather than trusting that it was written correctly.

-- Assert the replacement is in place before removing the original. If Phase 1's index is somehow
-- absent, this migration must fail rather than leave the table with no uniqueness at all — a
-- window in which two BUYER envelopes could be written for one deal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND indexname  = 'e_sign_envelopes_deal_id_signer_kind_key'
  ) THEN
    RAISE EXCEPTION
      'REFUSED: e_sign_envelopes_deal_id_signer_kind_key is missing. Phase 1 (20261106000100) '
      'creates it. Dropping e_sign_envelopes_deal_id_key without it would leave e_sign_envelopes '
      'with NO uniqueness on deal_id and permit two BUYER envelopes for one deal.';
  END IF;
END $$;

-- Refuse to widen while a deal already holds two envelopes under some other path. Vacuous today
-- (the surviving index forbids it), and asserted anyway so the guarantee is checked rather than
-- reasoned about — the same reason preflight.sql exists.
DO $$
DECLARE dupes INT;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT deal_id FROM e_sign_envelopes GROUP BY deal_id HAVING count(*) > 1
  ) d;
  IF dupes > 0 THEN
    RAISE EXCEPTION 'REFUSED: % deal_id(s) already hold more than one envelope.', dupes;
  END IF;
END $$;

DROP INDEX IF EXISTS "e_sign_envelopes_deal_id_key";
