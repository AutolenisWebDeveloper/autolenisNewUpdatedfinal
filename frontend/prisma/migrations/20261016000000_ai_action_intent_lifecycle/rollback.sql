-- Rollback for 20261016000000_ai_action_intent_lifecycle.
--
-- Safe and complete: the forward migration only ADDED one table and one enum
-- and touched no existing object, so dropping them fully reverts it. Run only if
-- the forward migration has been applied and you intend to remove the feature.
-- The table ships dormant, so under normal operation it holds no rows.

DROP TABLE IF EXISTS "ai_action_intents";

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiActionIntentStatus') THEN
    DROP TYPE "AiActionIntentStatus";
  END IF;
END
$$;
