-- Idempotent Supabase SQL for Tier 0 (WO-2 + WO-3).
-- Safe to run directly against the Supabase Postgres instance; re-runnable.
-- Mirrors prisma/migrations/20260915000000_tier0_claim_token_and_ism_contact.

-- WO-2 — secure dealer account-claim token (hash-at-rest, single-use, 7-day TTL).
CREATE TABLE IF NOT EXISTS "dealer_account_claim_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "application_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_by_admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "dealer_account_claim_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "dealer_account_claim_tokens_token_hash_key" ON "dealer_account_claim_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "dealer_account_claim_tokens_token_hash_idx" ON "dealer_account_claim_tokens"("token_hash");
CREATE INDEX IF NOT EXISTS "dealer_account_claim_tokens_dealer_id_idx" ON "dealer_account_claim_tokens"("dealer_id");

-- WO-3 — persist ISM contact independently of email.
ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "contact_phone" TEXT;
ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "contact_source_url" TEXT;
ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "contact_source" TEXT;
ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "contact_confidence" TEXT;
ALTER TABLE "dealer_prospects" ADD COLUMN IF NOT EXISTS "contact_enriched_at" TIMESTAMP(3);
