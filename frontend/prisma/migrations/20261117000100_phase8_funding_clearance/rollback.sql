-- Rollback for migration 115 — drop the four funding-clearance columns.
--
-- SAFE UNCONDITIONALLY, because the migration was additive: nothing read these columns
-- before it, and a revert returns `evaluateFundingClearance` to reporting items 2, 3 and 4
-- as outstanding rather than satisfied. That is the correct degraded behaviour — the
-- clearance check fails CLOSED when its evidence is unavailable, which is the whole point
-- of the no-conditional-delivery rule.
--
-- IT DOES DESTROY RECORDED EVIDENCE. Any deal whose lender conditions, down-payment method
-- or dealership funding confirmation have already been recorded loses those facts, and
-- Finance would have to re-record them after a re-apply. At the time of writing production
-- holds zero rows in `financing` carrying any of them, so nothing is lost today. If that
-- changes, capture the four columns before running this:
--
--   SELECT deal_id, lender_conditions_cleared_at, down_payment_method,
--          dealer_funding_confirmed_at, funding_recorded_by
--     FROM financing
--    WHERE lender_conditions_cleared_at IS NOT NULL
--       OR down_payment_method IS NOT NULL
--       OR dealer_funding_confirmed_at IS NOT NULL;

ALTER TABLE "financing"
  DROP COLUMN IF EXISTS "lender_conditions_cleared_at",
  DROP COLUMN IF EXISTS "down_payment_method",
  DROP COLUMN IF EXISTS "dealer_funding_confirmed_at",
  DROP COLUMN IF EXISTS "funding_recorded_by";
