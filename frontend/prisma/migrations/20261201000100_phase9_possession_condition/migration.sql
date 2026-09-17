-- Phase 9 — `pickups.condition_at_possession`: the buyer's condition report stops overwriting
-- the dealership's.
--
-- STATUS: AUTHORED, NOT APPLIED. Applying it is the owner's, per run, under CLAUDE.md's
-- production-database protocol.
--
-- THE DEFECT. §Stage 18 records what the DEALERSHIP observed at release; §Stage 19 records what
-- the BUYER observed at possession; §Stage 20 requires "Buyer possession, VIN, mileage, and
-- condition confirmed" as one of its fourteen preconditions. Three separate facts, and the
-- schema had one column for two of them. `recordDealerRelease` wrote the dealership's condition
-- to `condition_at_release`, and `confirmPossession` wrote the BUYER's to the same column
-- minutes later — so every completed handover destroyed the dealership's release record, and the
-- surviving value was labelled as the dealer's while holding the buyer's words.
--
-- Nothing about that is visible in the data afterwards. The column is populated, the type is
-- right, and the only way to notice is to read both writers.
--
-- WHY A SEPARATE MIGRATION RATHER THAN AN EDIT TO 20261201000000. That one is authored and
-- unapplied, so amending it would have been mechanically possible — and it is exactly the habit
-- that makes a migration chain untrustworthy. It is already published on an open pull request
-- with review sign-off; CI replays the whole chain against an empty database, and a reviewer who
-- read a file that later changed under the same name has reviewed nothing. Forward-only, always.
--
-- THE MILEAGE CASE PROVES THE INTENT. `odometer_at_release` and `odometer_at_possession` both
-- exist and have since the Phase 1 wave. The same split was always meant for condition; it was
-- missed, and no writer existed to reveal it until Phase 9 wrote both halves.
--
-- NO BACKFILL, AND THAT IS A DECISION RATHER THAN AN OMISSION. `pickups` holds zero rows in
-- production, so there is nothing to split. Were there rows, no backfill would be correct
-- either: a populated `condition_at_release` on a completed pickup cannot be attributed to one
-- party or the other after the fact — which is the whole defect — and guessing would fabricate
-- evidence about a vehicle's condition at handover. Existing rows keep whatever they hold, and
-- `condition_at_possession` starts NULL, which reads truthfully as "not recorded".

ALTER TABLE "pickups"
  ADD COLUMN IF NOT EXISTS "condition_at_possession" TEXT;

COMMENT ON COLUMN "pickups"."condition_at_release" IS
  'Vehicle condition as the DEALERSHIP recorded it at release (Stage 18). Never the buyer''s.';

COMMENT ON COLUMN "pickups"."condition_at_possession" IS
  'Vehicle condition as the BUYER reported it at possession (Stage 19). One of Stage 20''s fourteen completion preconditions.';
