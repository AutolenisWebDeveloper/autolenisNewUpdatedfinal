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

ALTER TABLE "financing"
  ADD COLUMN IF NOT EXISTS "lender_conditions_cleared_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "down_payment_method"          TEXT,
  ADD COLUMN IF NOT EXISTS "dealer_funding_confirmed_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "funding_recorded_by"          TEXT;
