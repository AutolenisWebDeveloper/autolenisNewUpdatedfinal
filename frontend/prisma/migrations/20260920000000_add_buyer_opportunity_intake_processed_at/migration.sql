-- S1/S2 — durable intake completion marker.
-- Set when autolenis/intake.process finishes; NULL rows are re-driven by the
-- intake-reconcile cron. Nullable + additive → safe, no backfill needed.
ALTER TABLE "buyer_opportunities" ADD COLUMN "intake_processed_at" TIMESTAMP(3);
