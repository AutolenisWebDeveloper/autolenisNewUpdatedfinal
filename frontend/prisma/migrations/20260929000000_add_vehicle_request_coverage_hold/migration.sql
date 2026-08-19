-- Y2 — request-time coverage gate soft-hold flags on vehicle_requests.
--
-- Additive + idempotent. Two nullable columns record a SOFT-HOLD when the shared
-- coverage primitive (assessCoverageForZip) counts fewer than MIN_COVERAGE_DEALERS
-- contactable rooftops around the buyer at request time. This is a flag, NOT a new
-- VehicleRequestStatus — it never blocks the buyer and never changes the request's
-- lifecycle state; it only signals thin coverage so recruitment is kicked and
-- downstream (deposit-activation radius ladder / ops) can see it. Both columns
-- clear once coverage recovers (the gate is idempotent set-or-clear). The index on
-- coverage_hold_at supports ops/reconciler queries for currently-held requests.
--
-- Rollback:
--   DROP INDEX IF EXISTS "vehicle_requests_coverage_hold_at_idx";
--   ALTER TABLE "vehicle_requests" DROP COLUMN IF EXISTS "coverage_hold_reason";
--   ALTER TABLE "vehicle_requests" DROP COLUMN IF EXISTS "coverage_hold_at";

ALTER TABLE "vehicle_requests" ADD COLUMN IF NOT EXISTS "coverage_hold_at" TIMESTAMP(3);
ALTER TABLE "vehicle_requests" ADD COLUMN IF NOT EXISTS "coverage_hold_reason" TEXT;

CREATE INDEX IF NOT EXISTS "vehicle_requests_coverage_hold_at_idx" ON "vehicle_requests"("coverage_hold_at");
