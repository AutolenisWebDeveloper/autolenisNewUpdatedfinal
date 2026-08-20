-- C1 — Auction.vehicleRequestId: make the Auction↔VehicleRequest link a real FK.
--
-- The domain model has always described an auction as belonging to a
-- VehicleRequest, but the column never existed — the tie was a convention. This
-- adds the nullable FK, an index, and a best-effort backfill for existing rows.
--
-- NULLABLE by design: the admin launch path can supply the request (validated to
-- the buyer in app code), but the deposit-activation reconciler has no request in
-- scope. No UNIQUE constraint — a retry auction legitimately shares its request.
-- onDelete SET NULL — an auction is a historical/financial record and must survive
-- its request being removed.
--
-- Additive + idempotent. No RLS change (column add on the already-protected
-- `auctions` table). The FK/index names match Prisma's derived names so a later
-- `migrate dev` sees no drift.
--
-- ⚠️ REQUIRED PRE-LIVE STEP: apply to production with `prisma migrate deploy`.
--    The Vercel build does NOT run migrations.
--
-- Backfill policy: UNAMBIGUOUS-ONLY (verified against prod: 1 of 6 auctions links,
-- 5 stay null). (1) from the AUCTION_LAUNCHED_BY_ADMIN audit metadata, same-buyer
-- only; (2) fallback where the buyer has exactly one VehicleRequest that is not
-- temporally impossible (created no later than the auction); otherwise leave NULL.
-- Both steps only fill NULLs, so re-running is a no-op.
--
-- Rollback:
--   ALTER TABLE "auctions" DROP CONSTRAINT IF EXISTS "auctions_vehicle_request_id_fkey";
--   DROP INDEX IF EXISTS "auctions_vehicle_request_id_idx";
--   ALTER TABLE "auctions" DROP COLUMN IF EXISTS "vehicle_request_id";

ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "vehicle_request_id" TEXT;

DO $$ BEGIN
  ALTER TABLE "auctions"
    ADD CONSTRAINT "auctions_vehicle_request_id_fkey"
    FOREIGN KEY ("vehicle_request_id") REFERENCES "vehicle_requests"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "auctions_vehicle_request_id_idx"
  ON "auctions"("vehicle_request_id");

-- Backfill 1 — from admin launch audit metadata (most reliable), same-buyer only.
UPDATE "auctions" a
SET "vehicle_request_id" = (aal."metadata"->>'vehicleRequestId')
FROM "admin_audit_logs" aal
WHERE aal."entity_type" = 'Auction'
  AND aal."entity_id" = a."id"
  AND aal."action" = 'AUCTION_LAUNCHED_BY_ADMIN'
  AND aal."metadata"->>'vehicleRequestId' IS NOT NULL
  AND a."vehicle_request_id" IS NULL
  AND EXISTS (
    SELECT 1 FROM "vehicle_requests" vr
    WHERE vr."id" = (aal."metadata"->>'vehicleRequestId')
      AND vr."buyer_id" = a."buyer_id"
  );

-- Backfill 2 — fallback where the buyer has exactly one VehicleRequest, AND that
-- request is not temporally impossible as the origin (created no later than the
-- auction). Without the temporal guard a buyer's later, unrelated sole request
-- would mislink: verified against prod, one of the two single-VR candidates has a
-- request created a month AFTER its auction — correctly left null here.
UPDATE "auctions" a
SET "vehicle_request_id" = vr."id"
FROM "vehicle_requests" vr
WHERE vr."buyer_id" = a."buyer_id"
  AND a."vehicle_request_id" IS NULL
  AND vr."created_at" <= a."created_at"
  AND (
    SELECT COUNT(*) FROM "vehicle_requests" vr2 WHERE vr2."buyer_id" = a."buyer_id"
  ) = 1;
