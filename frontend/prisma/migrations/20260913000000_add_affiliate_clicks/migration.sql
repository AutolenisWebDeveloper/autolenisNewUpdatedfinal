-- Group 8 (8A) — Affiliate referral click tracking.
-- One row per inbound visit carrying an affiliate ?ref= code. Distinct from
-- affiliate_referrals (completed signups): this is the top of the funnel.
--
-- Idempotent: guarded with IF NOT EXISTS / pg_constraint checks so the
-- migration is a safe no-op on environments where the table was already
-- provisioned out of band (e.g. via the Supabase drift-repair migration).

-- CreateTable
CREATE TABLE IF NOT EXISTS "affiliate_clicks" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "user_agent" TEXT,
    "referer" TEXT,
    "landing_path" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "converted_at" TIMESTAMP(3),
    "referred_user_id" TEXT,

    CONSTRAINT "affiliate_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_clicks_affiliate_id_clicked_at_idx" ON "affiliate_clicks"("affiliate_id", "clicked_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "affiliate_clicks_referral_code_idx" ON "affiliate_clicks"("referral_code");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'affiliate_clicks_affiliate_id_fkey'
  ) THEN
    ALTER TABLE "affiliate_clicks" ADD CONSTRAINT "affiliate_clicks_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
