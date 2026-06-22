-- Migration: add_dealer_prospect_claim
-- F-010 — one-click recruitment claim. A responding prospect self-converts into
-- a pre-filled DealerApplication via a tokenized link in the outreach email,
-- instead of re-entering everything on the public form. Idempotent.

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'dealer_prospects')) IS NOT NULL THEN
    ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "claim_token" TEXT;
    ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "claim_token_expires_at" TIMESTAMP(3);
    ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "converted_application_id" TEXT;
  END IF;
END $$;

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'dealer_prospects')) IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "dealer_prospects_claim_token_key"
      ON "dealer_prospects" ("claim_token");
  END IF;
END $$;
