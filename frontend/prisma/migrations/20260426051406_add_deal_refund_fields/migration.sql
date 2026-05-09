-- Migration: add feeRefundedAt and feeRefundedAmountCents to deals table
ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "fee_refunded_at"           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "fee_refunded_amount_cents"  INTEGER;

COMMENT ON COLUMN "deals"."fee_refunded_at" IS 'Timestamp when the concierge fee was refunded to the buyer';
COMMENT ON COLUMN "deals"."fee_refunded_amount_cents" IS 'Exact amount in cents refunded for the concierge fee';
