-- Rollback for 20261117000200.
--
-- REFUSES rather than destroys while any executed contract is stored. Dropping the column
-- orphans documents the buyer, the dealership and Operations are entitled to retrieve, and
-- leaves `executed_document_hash` proving the integrity of something unreachable. That is not
-- a loss a rollback may take on its own.
DO $$
DECLARE
  live_executed BIGINT;
BEGIN
  SELECT count(*) INTO live_executed
  FROM "contract_versions" WHERE "executed_document_key" IS NOT NULL;

  IF live_executed > 0 THEN
    RAISE EXCEPTION
      'REFUSING to roll back 20261117000200: % stored executed contracts would be orphaned. Re-key the documents first.',
      live_executed;
  END IF;
END $$;

ALTER TABLE "contract_versions" DROP COLUMN IF EXISTS "executed_document_key";
