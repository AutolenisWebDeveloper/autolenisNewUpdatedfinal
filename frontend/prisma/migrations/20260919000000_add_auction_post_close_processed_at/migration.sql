-- Migration: add_auction_post_close_processed_at
-- F-001 — durable marker so the auction-close cron becomes a self-healing
-- reconciler. Post-close side effects (dealer load release, offer ranking,
-- buyer win/no-offer notice, zero-offer auto-refund) are claimed atomically and
-- stamped here on completion. The cron then processes any CLOSED auction where
-- this is NULL, replacing the fragile trailing 6-minute window that silently
-- dropped notifications when a cron tick was missed or slow.
-- Idempotent (safe to re-run).

DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'auctions')) IS NOT NULL THEN
    ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "post_close_processed_at" TIMESTAMP(3);
  END IF;
END $$;

-- Backfill: any auction already CLOSED before this migration is treated as
-- already processed, so the reconciler does not re-fire stale notifications on
-- first deploy. New closes (post_close_processed_at NULL) flow through normally.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'auctions')) IS NOT NULL THEN
    UPDATE "auctions"
      SET "post_close_processed_at" = COALESCE("closed_at", NOW())
      WHERE "status" = 'CLOSED' AND "post_close_processed_at" IS NULL;
  END IF;
END $$;

-- Partial index keeps the reconciler query (CLOSED + unprocessed) cheap as the
-- auctions table grows.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'auctions')) IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS "auctions_post_close_unprocessed_idx"
      ON "auctions" ("status")
      WHERE "post_close_processed_at" IS NULL;
  END IF;
END $$;
