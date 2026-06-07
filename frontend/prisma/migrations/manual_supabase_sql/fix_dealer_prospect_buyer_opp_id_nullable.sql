-- Make dealer_prospects.buyer_opp_id nullable.
--
-- AMIPS bulk dealer discovery (Gemini Maps + Apollo imports) has no
-- originating buyer opportunity, so it must be able to create DealerProspect
-- rows with buyer_opp_id = NULL. Buyer-intake prospects continue to pass a
-- real buyer_opp_id.
--
-- Idempotent in effect: dropping NOT NULL on a column that is already nullable
-- is a no-op, so running this twice is safe.

ALTER TABLE dealer_prospects
ALTER COLUMN buyer_opp_id DROP NOT NULL;
