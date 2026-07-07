-- Migration: add_referral_milestone_config
-- GAP-CRIT #8 — referral milestone thresholds were undefined (no engine created
-- milestones and amounts were not configurable). Adds an admin-configurable
-- threshold table + a uniqueness guard so a buyer earns each milestone at most
-- once (idempotent awarding). Payout stays a manual admin action.
-- Idempotent (safe to re-run).

CREATE TABLE IF NOT EXISTS "referral_milestone_configs" (
  "id"           TEXT PRIMARY KEY,
  "threshold"    INTEGER NOT NULL,
  "label"        TEXT NOT NULL,
  "reward_type"  TEXT NOT NULL DEFAULT 'CASH',
  "reward_value" INTEGER NOT NULL,
  "active"       BOOLEAN NOT NULL DEFAULT true,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "referral_milestone_configs_threshold_key"
  ON "referral_milestone_configs" ("threshold");

-- Guard so the awarding engine can upsert each buyer's milestone at most once.
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'referral_milestones')) IS NOT NULL THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "referral_milestones_buyer_id_milestone_key"
      ON "referral_milestones" ("buyer_id", "milestone");
  END IF;
END $$;
