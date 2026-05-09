-- Add application + digest fields to affiliates so admin queue can render full details
-- and weekly digest cron can watermark sends + honor unsubscribe preference.

ALTER TABLE "affiliates"
  ADD COLUMN "promotion_method"        TEXT,
  ADD COLUMN "website"                 TEXT,
  ADD COLUMN "ftc_acknowledged_at"     TIMESTAMP(3),
  ADD COLUMN "weekly_digest_enabled"   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "last_digest_sent_at"     TIMESTAMP(3),
  ADD COLUMN "unsubscribe_token"       TEXT;

CREATE UNIQUE INDEX "affiliates_unsubscribe_token_key" ON "affiliates"("unsubscribe_token");
