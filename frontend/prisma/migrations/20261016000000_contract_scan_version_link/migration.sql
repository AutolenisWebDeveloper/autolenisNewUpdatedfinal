-- ============================================================================
-- ⚠️  LOCAL / STAGING ONLY — NOT APPLIED TO PRODUCTION IN THIS CHANGE. ⚠️
--
-- REQUIRES OWNER APPROVAL AND A SEPARATE PRODUCTION DEPLOY.
--
-- CODE-PATH DEPENDENCY (read before deploying):
--   The Contract Shield admin-approval compliance gate
--   (approveContractVersionByAdmin, lib/services/dealer/dealer-contract.service.ts)
--   binds an admin APPROVE to contract_scans.contract_version_id — the exact
--   document the reviewed scan judged. Until this column exists in production,
--   every scan row is written with a NULL link, the gate HARD REFUSES the
--   approval (code NO_LINKED_VERSION, HTTP 409) and the admin must re-scan the
--   contract to produce a linked verdict. In other words: the enforcement is not
--   live until this migration is deployed, and once it is deployed, only scans
--   created AFTER it can be approved. Pre-existing scans stay NULL by design —
--   no backfill heuristic is provided, because guessing which version a legacy
--   verdict judged is exactly the defect this closes.
--
-- Idempotent: safe to run more than once, and safe to run either via
--   `prisma migrate deploy` or by pasting into the Supabase SQL editor
--   (mirrored at prisma/migrations/manual_supabase_sql/contract_scan_version_link.sql).
-- Reversible: see the ROLLBACK block at the bottom.
-- ============================================================================

ALTER TABLE "contract_scans"
  ADD COLUMN IF NOT EXISTS "contract_version_id" TEXT;

CREATE INDEX IF NOT EXISTS "contract_scans_contract_version_id_idx"
  ON "contract_scans" ("contract_version_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'contract_scans_contract_version_id_fkey'
  ) THEN
    ALTER TABLE "contract_scans"
      ADD CONSTRAINT "contract_scans_contract_version_id_fkey"
      FOREIGN KEY ("contract_version_id") REFERENCES "contract_versions"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- ROLLBACK (run only if the application code is rolled back with it — the
-- approval gate reads this column):
--   ALTER TABLE "contract_scans" DROP CONSTRAINT IF EXISTS "contract_scans_contract_version_id_fkey";
--   DROP INDEX IF EXISTS "contract_scans_contract_version_id_idx";
--   ALTER TABLE "contract_scans" DROP COLUMN IF EXISTS "contract_version_id";
-- ---------------------------------------------------------------------------
