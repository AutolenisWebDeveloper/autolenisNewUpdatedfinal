-- Migration 115 — the funding-clearance facts (§Stage 14). Phase 8.
--
-- Stage 14 lists six things funding clearance requires. Three of them had nowhere to be
-- recorded:
--
--   2. "Every external lender condition and stipulation is satisfied."
--   3. "The down-payment arrangement is complete and its METHOD recorded by the dealership."
--   4. "The dealership confirms funding or funding authorization."
--
-- The other three already have homes and are NOT duplicated here: item 1 reads
-- `financing.status` + `financing.expires_at`, item 5 reads
-- `deal_recaps.payoff_good_through_date`, and item 6 reads the deposit's own status and
-- the deal's fee-refund marker.
--
-- WHY ON `financing` AND NOT A NEW TABLE. All three are financing facts about this deal's
-- money, and `financing` already carries the deal-time down payment, the verifier and the
-- external reference. A `funding_clearance` table would have been a second home for the
-- same subject holding half a concept, with the other half still on three other records —
-- the duplication rule applied to data.
--
-- `down_payment_method` is TEXT rather than an enum deliberately. The set of ways a
-- dealership collects a down payment (cashier's cheque, ACH, card, trade equity, rollover,
-- a split of several) is the dealership's business and varies by state and by lender.
-- Constraining it to labels AutoLenis invented would make the honest answer unrecordable,
-- and item 3 asks that the method be RECORDED, not that it be one of ours.
--
-- ADDITIVE AND IDEMPOTENT. Four nullable columns, no default, no backfill, no constraint
-- change. `IF NOT EXISTS` on each, so a second application is a no-op — which CI's
-- migrations job asserts by applying the chain twice.
--
-- ROLLBACK. rollback.sql drops what this created, which is safe precisely because it is
-- additive: nothing read these columns before this migration and a revert returns the
-- clearance evaluation to reporting items 2-4 as outstanding. That is the correct
-- degraded behaviour — clearance fails closed rather than clearing on missing evidence.

-- ── AND THE COLUMN THE SIGNER ARCHIVE NEEDS ───────────────────────────────────
--
-- §13-D30 gives ESignEnvelopeHistory a `signer_kind` too, and this creates it. Without the
-- column the archive collapses the buyer's and the co-buyer's terminal attempts into one
-- undifferentiated list — which is precisely the evidence a signature dispute turns on —
-- and, worse, every archive write would fail with 42703 the moment the Prisma model
-- declared the field.
--
-- FOUND BY THE DRIFT GATE, NOT BY REVIEW. schema.prisma declared the field and no migration
-- created it; `check-migration-drift.ts` reported "missing column: signer_kind" against a
-- chain-built database. That is the functional half of the gate, held at hard zero for
-- exactly this failure: a column the application asks for and the database does not have.
--
-- NOT NULL DEFAULT 'BUYER' mirrors e_sign_envelopes: every archived attempt that exists was
-- a buyer's, so the default is the truth for every historical row rather than a placeholder.
ALTER TABLE "e_sign_envelope_history"
  ADD COLUMN IF NOT EXISTS "signer_kind" "ESignSignerKind" NOT NULL DEFAULT 'BUYER';

-- The index on the co-buyer foreign key. Phase 1 created `co_buyer_id` and its FK but not an
-- index, because nothing read the column — Phase 8's Prisma relation is its first reader, and
-- `@@index([coBuyerId])` declared without a matching CREATE INDEX is drift the gate reports as
-- a structural statement (it did: 345 against a pinned 344).
--
-- It is worth having rather than worth un-declaring: a co-buyer's envelope is looked up FROM
-- the co-buyer on the signing surface, and an unindexed FK on a table that grows with every
-- deal is a sequential scan waiting for volume.
CREATE INDEX IF NOT EXISTS "e_sign_envelopes_co_buyer_id_idx"
  ON "e_sign_envelopes" ("co_buyer_id");

ALTER TABLE "financing"
  ADD COLUMN IF NOT EXISTS "lender_conditions_cleared_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "down_payment_method"          TEXT,
  ADD COLUMN IF NOT EXISTS "dealer_funding_confirmed_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "funding_recorded_by"          TEXT;
