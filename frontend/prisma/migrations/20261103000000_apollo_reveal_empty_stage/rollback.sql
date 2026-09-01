-- Rollback for 20261103000000_apollo_reveal_empty_stage.
--
-- Safe to run: empty_stage is a diagnostic column nothing else depends on — no
-- foreign key, no index, no constraint, and no ledger or billing path reads it.
-- Dropping it loses the recorded drop-off stage of EMPTY reveals and nothing
-- else; credits_cost and the ledger are untouched.

ALTER TABLE "apollo_reveals" DROP COLUMN IF EXISTS "empty_stage";
