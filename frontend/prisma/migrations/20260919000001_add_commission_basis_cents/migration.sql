-- Migration: add_commission_basis_cents
-- F-004 — persist the actual fee a commission was computed against, so payouts
-- are auditable per-deal instead of being implicitly tied to a hardcoded $499
-- constant. amount_cents = round(basis_cents * rate). Idempotent.

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'commissions')) IS NOT NULL THEN
    ALTER TABLE "commissions" ADD COLUMN IF NOT EXISTS "basis_cents" INTEGER;
  END IF;
END $$;
