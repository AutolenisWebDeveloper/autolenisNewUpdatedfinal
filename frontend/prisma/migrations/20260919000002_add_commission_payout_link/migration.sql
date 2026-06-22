-- Migration: add_commission_payout_link
-- F-002/F-003 — link each commission to the settlement that actually paid it.
-- Consolidates payouts onto the single per-commission mark-paid rail: a
-- Commission flips to PAID only inside the same transaction that records a real
-- AffiliatePayout, with payout_id pointing at it. The previously orphaned
-- self-serve requestPayout rail (which created PENDING payouts that never
-- settled and prematurely stamped paid_at) is disabled in code. Idempotent.

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'commissions')) IS NOT NULL THEN
    ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "payout_id" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'commissions')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "commissions_payout_id_idx" ON "commissions" ("payout_id");
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'commissions')) IS NOT NULL
     AND to_regclass(format('%I.%I', current_schema(), 'affiliate_payouts')) IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.table_constraints
       WHERE constraint_name = 'commissions_payout_id_fkey'
         AND table_name = 'commissions'
     )
  THEN
    ALTER TABLE "commissions"
      ADD CONSTRAINT "commissions_payout_id_fkey"
      FOREIGN KEY ("payout_id") REFERENCES "affiliate_payouts"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
