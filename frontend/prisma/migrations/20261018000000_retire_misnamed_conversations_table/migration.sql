-- Retire the misnamed acquisition "conversations" table, shape-guarded.
--
-- 20260911000000 (before its Batch-7 correction) created the acquisition
-- conversation store under the bare name "conversations", while the model maps
-- to "acquisition_conversations". On every database built from this chain, the
-- bare table is an orphan: no Prisma model owns it, prisma.conversation writes
-- to acquisition_conversations, and the admin-CRM code that DOES use the name
-- "conversations" expects a completely different shape (contact_id, channel,
-- unread_count — created by frontend/migrations/01_phase1_foundation.sql).
-- While the orphan holds the name, that CRM file's CREATE TABLE IF NOT EXISTS
-- silently skips, its transaction aborts on the first contact_id index, and 14
-- of the 15 documented provisioning files fail.
--
-- SAFETY: the guard is on SHAPE, not just name. In production the name
-- "conversations" belongs to the LIVE CRM inbox table — dropping by name alone
-- would destroy real support data. A table is only touched here if it has
-- session_id and does NOT have contact_id: the acquisition shape, which the
-- application has never been able to reach under this name.
--   - acquisition shape + empty     -> dropped
--   - acquisition shape + rows      -> renamed to conversations_misnamed_acquisition_bak
--                                      (frees the name; preserves whatever was
--                                      inserted out of band for the operator)
--   - CRM shape / absent            -> untouched
--
-- ROLLBACK: recreate from 20260911000000's original definition if ever needed;
-- the renamed backup, where one exists, can simply be renamed back.

DO $$
DECLARE
  n bigint;
BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'conversations')) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'conversations' AND column_name = 'session_id'
     )
     AND NOT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'conversations' AND column_name = 'contact_id'
     ) THEN
    EXECUTE 'SELECT count(*) FROM "conversations"' INTO n;
    IF n = 0 THEN
      DROP TABLE "conversations";
      RAISE NOTICE 'dropped empty misnamed acquisition table "conversations"';
    ELSE
      ALTER TABLE "conversations" RENAME TO "conversations_misnamed_acquisition_bak";
      RAISE NOTICE 'renamed non-empty misnamed table to conversations_misnamed_acquisition_bak (% rows preserved)', n;
    END IF;
  END IF;
END $$;
