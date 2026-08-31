-- Rollback for 20261102000000_dealer_outreach_apollo_operational.
--
-- DESTRUCTIVE. Run only to reverse this migration on an environment where it
-- actually introduced these objects. Dropping apollo_person_candidates discards
-- every Apollo person record, including ones a credit was already spent
-- revealing — that spend is not recoverable. Export the table first if the
-- reveal data matters.
--
-- Ordered so dependants go before their dependencies.

DROP TABLE IF EXISTS "apollo_enrichment_runs";
DROP TABLE IF EXISTS "apollo_person_candidates";

DROP INDEX IF EXISTS "dealer_outreach_log_live_attempt_key";
DROP INDEX IF EXISTS "dealer_outreach_log_dealer_prospect_id_outreach_sequence_st_idx";

ALTER TABLE "dealer_outreach_log" DROP COLUMN IF EXISTS "consent_basis";
ALTER TABLE "dealer_outreach_log" DROP COLUMN IF EXISTS "call_duration_seconds";
ALTER TABLE "dealer_outreach_log" DROP COLUMN IF EXISTS "call_disposition";
ALTER TABLE "dealer_outreach_log" DROP COLUMN IF EXISTS "twilio_sid";
ALTER TABLE "dealer_outreach_log" DROP COLUMN IF EXISTS "from_phone";
ALTER TABLE "dealer_outreach_log" DROP COLUMN IF EXISTS "to_phone";

DROP INDEX IF EXISTS "dealer_contact_profiles_dnc_status_idx";
DROP INDEX IF EXISTS "dealer_contact_profiles_apollo_person_id_key";

ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "is_primary_contact";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "consent_basis_source";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "consent_basis_set_at";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "consent_basis";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "phone_type";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "dnc_checked_at";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "dnc_status";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "linkedin_url";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "apollo_last_synced_at";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "apollo_organization_id";
ALTER TABLE "dealer_contact_profiles" DROP COLUMN IF EXISTS "apollo_person_id";
