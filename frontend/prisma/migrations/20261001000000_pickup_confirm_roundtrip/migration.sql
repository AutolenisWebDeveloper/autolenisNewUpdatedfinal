-- D2a — dealer pickup confirm/propose round-trip.
--
-- Additive + idempotent. Adds four PickupStatus / NotificationType enum values
-- and the Pickup round-trip columns (proposed slot + CAS token + counter cap +
-- SLA-nudge markers). Each ADD VALUE is placed with BEFORE an EXISTING value so
-- the DB enum order matches the schema.prisma declaration order (no future
-- `migrate dev` drift), and anchors only on pre-existing labels — never on a
-- value added in this same migration. The new values are NOT used in this
-- migration, so the single-transaction ADD VALUE is safe on PG 17.
--
-- ⚠️ REQUIRED PRE-LIVE STEP: apply to production with `prisma migrate deploy`.
--    The Vercel build does NOT run migrations.
--
-- Rollback:
--   DROP INDEX IF EXISTS "pickups_status_proposed_at_idx";
--   ALTER TABLE "pickups"
--     DROP COLUMN IF EXISTS "counter_reminder_sent_at",
--     DROP COLUMN IF EXISTS "proposed_reminder_sent_at",
--     DROP COLUMN IF EXISTS "counter_count",
--     DROP COLUMN IF EXISTS "proposed_at",
--     DROP COLUMN IF EXISTS "proposed_by",
--     DROP COLUMN IF EXISTS "proposed_time";
--   -- (enum values cannot be dropped without recreating the type; they are inert
--   --  unless written, so a rollback leaves them in place harmlessly.)

ALTER TYPE "PickupStatus"     ADD VALUE IF NOT EXISTS 'PROPOSED'         BEFORE 'SCHEDULED';
ALTER TYPE "PickupStatus"     ADD VALUE IF NOT EXISTS 'DEALER_COUNTERED' BEFORE 'SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PICKUP_PROPOSED'  BEFORE 'PICKUP_SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PICKUP_COUNTERED' BEFORE 'PICKUP_SCHEDULED';

ALTER TABLE "pickups" ADD COLUMN IF NOT EXISTS "proposed_time"             TIMESTAMP(3);
ALTER TABLE "pickups" ADD COLUMN IF NOT EXISTS "proposed_by"               TEXT;
ALTER TABLE "pickups" ADD COLUMN IF NOT EXISTS "proposed_at"               TIMESTAMP(3);
ALTER TABLE "pickups" ADD COLUMN IF NOT EXISTS "counter_count"             INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pickups" ADD COLUMN IF NOT EXISTS "proposed_reminder_sent_at" TIMESTAMP(3);
ALTER TABLE "pickups" ADD COLUMN IF NOT EXISTS "counter_reminder_sent_at"  TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "pickups_status_proposed_at_idx" ON "pickups"("status", "proposed_at");
