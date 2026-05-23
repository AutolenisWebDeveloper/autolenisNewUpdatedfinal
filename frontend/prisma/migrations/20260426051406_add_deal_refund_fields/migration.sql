-- Migration: add feeRefundedAt and feeRefundedAmountCents to deals table
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'deals')) IS NOT NULL THEN
    ALTER TABLE "deals"
      ADD COLUMN IF NOT EXISTS "fee_refunded_at"           TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS "fee_refunded_amount_cents"  INTEGER;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'deals')) IS NOT NULL THEN
    COMMENT ON COLUMN "deals"."fee_refunded_at" IS 'Timestamp when the concierge fee was refunded to the buyer';
  END IF;
END $$;
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'deals')) IS NOT NULL THEN
    COMMENT ON COLUMN "deals"."fee_refunded_amount_cents" IS 'Exact amount in cents refunded for the concierge fee';
  END IF;
END $$;
