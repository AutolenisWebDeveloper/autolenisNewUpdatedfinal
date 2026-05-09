-- Migration: add_buyer_plan
-- Adds BuyerPlan enum and `plan` column on buyers (defaults to STANDARD).
-- Standard buyers pay only the $99 deposit (credited toward their purchase at closing).
-- Premium buyers pay the $499 concierge fee (less $99 deposit credit = $400 due after deal selection).

CREATE TYPE "BuyerPlan" AS ENUM ('STANDARD', 'PREMIUM');

ALTER TABLE "buyers" ADD COLUMN "plan" "BuyerPlan" NOT NULL DEFAULT 'STANDARD';
