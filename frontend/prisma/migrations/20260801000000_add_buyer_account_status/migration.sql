-- Migration: add_buyer_account_status
-- Adds suspension fields to buyers table for admin suspend/unsuspend actions
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "is_suspended"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "suspended_at"      TIMESTAMP(3);
ALTER TABLE "buyers" ADD COLUMN IF NOT EXISTS "suspended_reason"  TEXT;
