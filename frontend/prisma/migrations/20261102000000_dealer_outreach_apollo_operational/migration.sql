-- Operational dealer outreach: Apollo personnel sync, DNC/consent governance,
-- and the SMS + call channels on dealer_outreach_log.
--
-- WRITTEN BUT NOT APPLIED. This ships for owner review alongside the rest of the
-- unapplied chain. Nothing here has been run against any database.
--
-- SCOPE: ADDITIVE ONLY. No DROP COLUMN, no DROP TABLE. Production carries 1,532
-- dealer_prospects and 582 dealer_contact_profiles whose provenance columns are
-- what this change lets the owner evaluate; dropping any of them here would
-- destroy the evidence. dealer_prospects.contact_name / contact_title /
-- contact_phone / contact_linkedin become DERIVED on read but are deliberately
-- LEFT IN PLACE.
--
-- RLS: dealer_outreach_log, dealer_rooftops, dealer_contact_profiles,
-- dealer_intelligence and dealer_invitations run with RLS ENABLED and ZERO
-- policies. That combination is deny-all for anon/authenticated and bypass for
-- service_role — which is the intended posture. Adding a policy to a zero-policy
-- table OPENS access rather than hardening it, so this migration contains no
-- CREATE POLICY and does not touch RLS state on any table.
--
-- IDEMPOTENT: every statement is guarded, so re-running is a no-op.
--
-- ROLLBACK: see rollback.sql in this directory.

-- ─────────────────────────────────────────── dealer_contact_profiles: Apollo id
-- apollo_person_id is the SPEND idempotency key. The guard keys on the PERSON,
-- not the prospect: one Apollo person can surface under two rooftops, and a
-- per-prospect guard would reveal — and bill for — that person twice. The
-- uniqueness is enforced here rather than by a read-then-write in application
-- code, which cannot survive concurrency.
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "apollo_person_id" TEXT;
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "apollo_organization_id" TEXT;
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "apollo_last_synced_at" TIMESTAMP(3);
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "linkedin_url" TEXT;

-- ────────────────────────────────────── dealer_contact_profiles: phone channel
-- dnc_status holds Apollo's dnc_status_cd VERBATIM: 'found' | 'not_found' |
-- 'pending'. Only 'not_found' clears the phone channel. 'pending' is NOT a
-- clearance, and NULL means never checked — both block. Enforced in the send
-- service, not only in the UI.
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "dnc_status" TEXT;
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "dnc_checked_at" TIMESTAMP(3);

-- Apollo's phone classification: mobile_phone | direct_phone | corporate_phone.
-- Gated INDEPENDENTLY of DNC — a mobile carries materially higher risk than a
-- corporate line, so the send service must be able to allow one and block the
-- other. Never collapsed into a single "phone" field.
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "phone_type" TEXT;

-- TCPA basis for the phone channel:
--   EXPRESS_WRITTEN | EXPRESS | EXISTING_BUSINESS_RELATIONSHIP | NONE
-- Defaults to NONE, which always refuses whatever else is true. Nothing in this
-- change sets it otherwise, so SMS correctly reaches zero prospects on day one.
-- That is the intended outcome, not a gap to route around.
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "consent_basis" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "consent_basis_set_at" TIMESTAMP(3);
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "consent_basis_source" TEXT;

-- Which contact outreach addresses when a rooftop has several.
ALTER TABLE "dealer_contact_profiles" ADD COLUMN IF NOT EXISTS "is_primary_contact" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "dealer_contact_profiles_apollo_person_id_key" ON "dealer_contact_profiles"("apollo_person_id");
CREATE INDEX IF NOT EXISTS "dealer_contact_profiles_dnc_status_idx" ON "dealer_contact_profiles"("dnc_status");

-- ──────────────────────────────────────────── dealer_outreach_log: SMS + calls
-- `channel` already discriminates the medium; these are the non-email payloads.
ALTER TABLE "dealer_outreach_log" ADD COLUMN IF NOT EXISTS "to_phone" TEXT;
ALTER TABLE "dealer_outreach_log" ADD COLUMN IF NOT EXISTS "from_phone" TEXT;
ALTER TABLE "dealer_outreach_log" ADD COLUMN IF NOT EXISTS "twilio_sid" TEXT;

-- A logged human call. This is what turns 1,527 phone numbers into recorded
-- outreach without needing consent the prospects have not given.
ALTER TABLE "dealer_outreach_log" ADD COLUMN IF NOT EXISTS "call_disposition" TEXT;
ALTER TABLE "dealer_outreach_log" ADD COLUMN IF NOT EXISTS "call_duration_seconds" INTEGER;

-- The consent basis in force at SEND time, so an audit can reconstruct why a
-- message was or was not permitted. Null on email rows, where CAN-SPAM plus
-- suppression govern instead.
ALTER TABLE "dealer_outreach_log" ADD COLUMN IF NOT EXISTS "consent_basis" TEXT;

-- Name matches what Prisma generates for @@index([dealerProspectId,
-- outreachSequenceStep, channel]) — postgres truncates identifiers at 63
-- characters, so the generated name is elided mid-word. A different name here
-- is not cosmetic: prisma migrate diff reports it as an ALTER INDEX ... RENAME,
-- which the drift ratchet counts as structural drift and fails the build on.
CREATE INDEX IF NOT EXISTS "dealer_outreach_log_dealer_prospect_id_outreach_sequence_st_idx" ON "dealer_outreach_log"("dealer_prospect_id", "outreach_sequence_step", "channel");

-- ONE live attempt per (prospect, step, channel).
--
-- sendDealerEmail's idempotency check is read-then-write: two concurrent sends
-- for the same prospect and step both pass findFirst and both dispatch, so a
-- double-click or a prospect appearing in two batches can send twice. Only a
-- database constraint closes that. PARTIAL on non-failed rows so a failed
-- attempt stays retriable — which is exactly what makes the unconditional
-- failure logging safe to combine with this index.
--
-- PRE-FLIGHT, required before applying. CREATE UNIQUE INDEX FAILS if the table
-- already contains a duplicate. dealer_outreach_log held zero rows when this was
-- written, but the unconditional-logging change ships ahead of this migration
-- and the application-level idempotency check it relies on is read-then-write —
-- so by the time this is applied, duplicates are possible. Run this first and
-- expect zero rows:
--
--   SELECT dealer_prospect_id, outreach_sequence_step, channel, count(*)
--     FROM dealer_outreach_log
--    WHERE status <> 'failed'
--    GROUP BY 1, 2, 3
--   HAVING count(*) > 1;
--
-- Any row returned is a real duplicate send that must be reconciled by hand
-- before this index can be created. Do not resolve it by deleting log rows
-- blindly: each one records a message that was actually dispatched.
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_outreach_log_live_attempt_key" ON "dealer_outreach_log"("dealer_prospect_id", "outreach_sequence_step", "channel") WHERE "status" <> 'failed';

-- ────────────────────────────────────────────────── apollo_person_candidates
-- Results of Apollo People Search, the 0-credit acquisition path. Persisted
-- WITHOUT enrichment: search returns an obfuscated last name, which is expected
-- and does not block rooftop matching.
--
-- enrichment_status carries every terminal state explicitly, including the async
-- reveal outcomes (PENDING_REVEAL / EXPIRED / UNKNOWN_REQUEST / FAILED) that
-- must never be collapsed into a generic failure, and UNREACHABLE for a person
-- Apollo returned no contact detail for. Nothing is ever fabricated to fill a
-- gap — the columns stay null and the candidate is marked UNREACHABLE.
CREATE TABLE IF NOT EXISTS "apollo_person_candidates" (
    "id" TEXT NOT NULL,
    "apollo_person_id" TEXT NOT NULL,
    "apollo_organization_id" TEXT,
    "first_name" TEXT,
    "last_name_obfuscated" TEXT,
    "title" TEXT,
    "organization_name" TEXT,
    "organization_city" TEXT,
    "organization_state" TEXT,
    "organization_zip" TEXT,
    "organization_domain" TEXT,
    "linkedin_url" TEXT,
    "rooftop_id" TEXT,
    "match_method" TEXT,
    "match_confidence" TEXT,
    "enrichment_status" TEXT NOT NULL DEFAULT 'NEW',
    "enrichment_error" TEXT,
    "reveal_request_id" TEXT,
    "reveal_poll_count" INTEGER NOT NULL DEFAULT 0,
    "last_synced_at" TIMESTAMP(3),
    "search_run_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "apollo_person_candidates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "apollo_person_candidates_apollo_person_id_key" ON "apollo_person_candidates"("apollo_person_id");
CREATE INDEX IF NOT EXISTS "apollo_person_candidates_rooftop_id_idx" ON "apollo_person_candidates"("rooftop_id");
CREATE INDEX IF NOT EXISTS "apollo_person_candidates_enrichment_status_idx" ON "apollo_person_candidates"("enrichment_status");
CREATE INDEX IF NOT EXISTS "apollo_person_candidates_search_run_key_idx" ON "apollo_person_candidates"("search_run_key");

-- SetNull, not Cascade: a rooftop merge or delete must never silently destroy
-- the record of an Apollo person we already spent a credit revealing.
DO $$ BEGIN
    ALTER TABLE "apollo_person_candidates"
      ADD CONSTRAINT "apollo_person_candidates_rooftop_id_fkey"
      FOREIGN KEY ("rooftop_id") REFERENCES "dealer_rooftops"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ──────────────────────────────────────────────────── apollo_enrichment_runs
-- One credit-spending run. Exists so spend is auditable after the fact: the cap
-- the run was allowed, what it actually consumed, and — when it stopped early —
-- exactly why. A run that hits the cap records ABORTED_CAP with a reason rather
-- than ending silently.
CREATE TABLE IF NOT EXISTS "apollo_enrichment_runs" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "max_credits" INTEGER NOT NULL,
    "candidate_count" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" INTEGER NOT NULL DEFAULT 0,
    "credits_spent" INTEGER NOT NULL DEFAULT 0,
    "enriched_count" INTEGER NOT NULL DEFAULT 0,
    "empty_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "waterfall_enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "abort_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "started_by" TEXT,
    CONSTRAINT "apollo_enrichment_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "apollo_enrichment_runs_status_idx" ON "apollo_enrichment_runs"("status");
CREATE INDEX IF NOT EXISTS "apollo_enrichment_runs_started_at_idx" ON "apollo_enrichment_runs"("started_at");
