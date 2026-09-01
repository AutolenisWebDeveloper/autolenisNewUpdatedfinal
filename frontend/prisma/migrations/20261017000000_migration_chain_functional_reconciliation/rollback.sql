-- Rollback for 20261017000000_migration_chain_functional_reconciliation.
--
-- Destructive: run only to reverse this migration on an environment where it
-- introduced the objects. On a database that already had them (production built
-- by db push), the migration was a no-op and this rollback WOULD remove real
-- columns — check before running.
--
-- Enum values are deliberately not reversed: postgres cannot drop an enum value,
-- and they are additive by the chain's own convention.

DROP INDEX IF EXISTS "vehicle_requests_buyer_opportunity_id_idx";
DROP INDEX IF EXISTS "dealer_prospects_email_idx";
DROP INDEX IF EXISTS "buyer_opportunities_created_at_idx";
DROP INDEX IF EXISTS "ab_test_variants_group_id_idx";
DROP INDEX IF EXISTS "amips_intelligence_snapshots_captured_at_idx";

ALTER TABLE "vehicle_requests"             DROP COLUMN IF EXISTS "buyer_opportunity_id";
ALTER TABLE "prequal_consents"             DROP COLUMN IF EXISTS "terms_version";
ALTER TABLE "dealers"                      DROP COLUMN IF EXISTS "marketplace_agreement_signed_at",
                                           DROP COLUMN IF EXISTS "marketplace_agreement_sent_at",
                                           DROP COLUMN IF EXISTS "marketplace_agreement_envelope_id";
ALTER TABLE "affiliate_compliance_records" DROP COLUMN IF EXISTS "user_agent",
                                           DROP COLUMN IF EXISTS "ip_address";

DROP TABLE IF EXISTS "amips_intelligence_snapshots";
