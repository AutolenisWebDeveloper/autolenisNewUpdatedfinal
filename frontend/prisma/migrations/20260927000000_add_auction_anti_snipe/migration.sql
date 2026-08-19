-- Y6 — anti-snipe auto-extension. Adds the auto-extension counter on auctions and
-- a typed source (+ minute-granular delta) on the extension log.
--
-- Additive + idempotent. Rollback:
--   ALTER TABLE "auctions" DROP COLUMN IF EXISTS "auto_extension_count";
--   ALTER TABLE "auction_extension_logs" DROP COLUMN IF EXISTS "minutes_added";
--   ALTER TABLE "auction_extension_logs" DROP COLUMN IF EXISTS "source";
--   DROP TYPE IF EXISTS "AuctionExtensionSource";

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AuctionExtensionSource') THEN
    CREATE TYPE "AuctionExtensionSource" AS ENUM ('MANUAL_ADMIN', 'ANTI_SNIPE');
  END IF;
END $$;

ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "auto_extension_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "auction_extension_logs" ADD COLUMN IF NOT EXISTS "minutes_added" INTEGER;
ALTER TABLE "auction_extension_logs" ADD COLUMN IF NOT EXISTS "source" "AuctionExtensionSource" NOT NULL DEFAULT 'MANUAL_ADMIN';
