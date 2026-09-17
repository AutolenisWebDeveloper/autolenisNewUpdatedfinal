-- Rollback for 20261201000100_phase9_possession_condition.
--
-- SAFE ONLY WHILE NO WRITER EXISTS. Dropping this column after `confirmPossession` has recorded
-- a buyer's condition report destroys evidence about a delivered vehicle, and §Stage 20 counts
-- that report among the fourteen preconditions — a completed deal would lose the fact it was
-- completed on. Check before running:
--
--   SELECT count(*) FROM pickups WHERE condition_at_possession IS NOT NULL;
--
-- A non-zero count means the application has already deployed against this column; roll the
-- application back first, and treat the column as data to preserve rather than schema to undo.

ALTER TABLE "pickups"
  DROP COLUMN IF EXISTS "condition_at_possession";

COMMENT ON COLUMN "pickups"."condition_at_release" IS NULL;
