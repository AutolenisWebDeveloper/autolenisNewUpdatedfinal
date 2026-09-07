-- Phase 1 ROLLBACK — drops ONLY what this wave itself created.
--
-- Specified at IMPLEMENTATION-WORKFLOW.md:1028-1038. This file is the reversal half of the wave and
-- is never run by Prisma: it is an owner-run script for the maintenance window, applied by hand if
-- the wave has to be taken back out before anything writes to the new columns.
--
-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- DENY-LIST — these four tables MUST NEVER BE DROPPED BY THIS FILE
--
--     comms_outbox · lifecycle_touch_schedule · idempotency_keys · jobs_dead_letter
--
-- They already exist in PRODUCTION (§5.2, §5.7). The wave adopts them with `CREATE TABLE IF NOT
-- EXISTS`, which creates nothing, so "drop what the wave created" must not touch them. Only the
-- COLUMNS the wave added to them are dropped, individually and by name, below. The Phase 1 chain
-- test asserts this file contains no `DROP TABLE` naming any of the four, and the final block
-- re-asserts at run time that all four survived.
--
-- RLS is deliberately absent from this file. All four adopted tables already had RLS enabled in
-- production before the wave (verified against the committed baseline), and the only tables whose
-- RLS the wave switched on are the ten it creates — which take their RLS with them when dropped.
--
-- ENUM LABELS ARE NOT DROPPED, and this file cannot make the wave fully reversible because of it:
-- PostgreSQL has no `ALTER TYPE ... DROP VALUE`. Every label directory 1 adds to a PRE-EXISTING type
-- stays for good. That is a property of the wave, not an omission here (§8.2). The nine types the
-- wave CREATES are dropped, because dropping the whole type is possible where dropping one label is
-- not.
--
-- The wave replaces two production CHECKs rather than only adding: `comms_outbox_channel_check` and
-- `comms_outbox_status_check` are widened. §"Rollback" claims the wave "replaces nothing"; that is
-- true of every other object but not of these two, so they are RESTORED to production's exact
-- definitions first, before anything that could depend on them goes. Restoring a NARROWER check
-- fails if a row already carries one of the widened values — which is the correct behaviour: it
-- means the rollback is no longer safe and the data must be reconciled first.
--
-- Every statement is guarded and re-runnable.
-- ════════════════════════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. restore the two widened CHECKs to production's definitions ───────────────────────────────
ALTER TABLE "comms_outbox" DROP CONSTRAINT IF EXISTS "comms_outbox_channel_check";
ALTER TABLE "comms_outbox" ADD  CONSTRAINT "comms_outbox_channel_check"
  CHECK (channel = ANY (ARRAY['email'::text, 'sms'::text]));
ALTER TABLE "comms_outbox" DROP CONSTRAINT IF EXISTS "comms_outbox_status_check";
ALTER TABLE "comms_outbox" ADD  CONSTRAINT "comms_outbox_status_check"
  CHECK (status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text,
                             'suppressed'::text, 'skipped'::text]));
-- `lifecycle_touch_sequence_allowed` is NOT restored: the wave restates it verbatim (all 19
-- sequences, deposit_reminder_5 and _6 included) and does not widen it, verified by comparing
-- `pg_get_constraintdef` before and after. There is nothing to undo.


-- ── 1b. restore the one COLUMN DEFINITION the wave relaxes ──────────────────────────────────────
-- `migration.sql` runs `ALTER TABLE "auction_invitations" ALTER COLUMN "dealer_id" DROP NOT NULL`
-- (S7-18: a rooftop that is not a registered dealer can be invited). That is the wave's only change
-- to an existing column's definition, and dropping the columns it ADDED does not put it back.
--
-- This fails if a NULL is already present, which is correct: a NULL `dealer_id` is an invitation the
-- pre-wave schema could not represent, so the rollback is not safe until those rows are reconciled.
ALTER TABLE "auction_invitations" ALTER COLUMN "dealer_id" SET NOT NULL;

-- ── 2. triggers and their functions ─────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS "auction_vehicles_enforce_cap_trg" ON "auction_vehicles";
DROP TRIGGER IF EXISTS "plan_snapshots_append_only_trg" ON "plan_snapshots";
DROP TRIGGER IF EXISTS "shortlist_items_enforce_cap_trg" ON "shortlist_items";
DROP FUNCTION IF EXISTS "auction_vehicles_enforce_cap"();
DROP FUNCTION IF EXISTS "plan_snapshots_append_only"();
DROP FUNCTION IF EXISTS "shortlist_items_enforce_cap"();

-- ── 3. constraints added to pre-existing tables ─────────────────────────────────────────────────
ALTER TABLE "affiliates" DROP CONSTRAINT IF EXISTS "affiliates_consent_ip_unavailable_reason_check";
ALTER TABLE "affiliates" DROP CONSTRAINT IF EXISTS "affiliates_consent_ip_unavailable_reason_exclusive";
ALTER TABLE "affiliates" DROP CONSTRAINT IF EXISTS "affiliates_ip_unavailable_reason_check";
ALTER TABLE "affiliates" DROP CONSTRAINT IF EXISTS "affiliates_ip_unavailable_reason_exclusive";
ALTER TABLE "buyer_opportunities" DROP CONSTRAINT IF EXISTS "buyer_opportunities_consent_ip_unavailable_reason_check";
ALTER TABLE "buyer_opportunities" DROP CONSTRAINT IF EXISTS "buyer_opportunities_consent_ip_unavailable_reason_exclusive";
ALTER TABLE "buyer_opportunities" DROP CONSTRAINT IF EXISTS "buyer_opportunities_ip_unavailable_reason_check";
ALTER TABLE "buyer_opportunities" DROP CONSTRAINT IF EXISTS "buyer_opportunities_ip_unavailable_reason_exclusive";
ALTER TABLE "dealer_applications" DROP CONSTRAINT IF EXISTS "dealer_applications_consent_ip_unavailable_reason_check";
ALTER TABLE "dealer_applications" DROP CONSTRAINT IF EXISTS "dealer_applications_consent_ip_unavailable_reason_exclusive";
ALTER TABLE "dealer_applications" DROP CONSTRAINT IF EXISTS "dealer_applications_ip_unavailable_reason_check";
ALTER TABLE "dealer_applications" DROP CONSTRAINT IF EXISTS "dealer_applications_ip_unavailable_reason_exclusive";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_offer_lineage_check";
ALTER TABLE "refinance_applications" DROP CONSTRAINT IF EXISTS "refinance_applications_consent_ip_unavailable_reason_check";
ALTER TABLE "refinance_applications" DROP CONSTRAINT IF EXISTS "refinance_applications_consent_ip_unavailable_reason_exclusive";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_consent_ip_unavailable_reason_check";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_consent_ip_unavailable_reason_exclusive";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_ip_unavailable_reason_check";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_ip_unavailable_reason_exclusive";
ALTER TABLE "auction_invitations" DROP CONSTRAINT IF EXISTS "auction_invitations_rooftop_id_fkey";
ALTER TABLE "auction_vehicles" DROP CONSTRAINT IF EXISTS "auction_vehicles_vehicle_request_id_fkey";
ALTER TABLE "auctions" DROP CONSTRAINT IF EXISTS "auctions_sourcing_case_id_fkey";
ALTER TABLE "buyer_opportunities" DROP CONSTRAINT IF EXISTS "buyer_opportunities_affiliate_id_fkey";
ALTER TABLE "circumvention_attempts" DROP CONSTRAINT IF EXISTS "circumvention_attempts_dealer_id_fkey";
ALTER TABLE "deal_status_history" DROP CONSTRAINT IF EXISTS "deal_status_history_deal_id_fkey";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_auction_id_fkey";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_co_buyer_id_fkey";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_current_plan_snapshot_fkey";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_dealer_executed_contract_id_fkey";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_dealer_id_fkey";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_deposit_id_fkey";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_rooftop_id_fkey";
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_vehicle_request_id_fkey";
ALTER TABLE "deposits" DROP CONSTRAINT IF EXISTS "deposits_vehicle_request_id_fkey";
ALTER TABLE "e_sign_envelopes" DROP CONSTRAINT IF EXISTS "e_sign_envelopes_co_buyer_id_fkey";
ALTER TABLE "external_pre_approval_documents" DROP CONSTRAINT IF EXISTS "external_pre_approval_documents_pre_approval_id_fkey";
ALTER TABLE "external_pre_approvals" DROP CONSTRAINT IF EXISTS "external_pre_approvals_deal_id_fkey";
ALTER TABLE "financing_audit_events" DROP CONSTRAINT IF EXISTS "financing_audit_events_financing_id_fkey";
ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "offers_auction_vehicle_id_fkey";
ALTER TABLE "offers" DROP CONSTRAINT IF EXISTS "offers_rooftop_id_fkey";
ALTER TABLE "shortlist_items" DROP CONSTRAINT IF EXISTS "shortlist_items_inventory_item_id_fkey";
ALTER TABLE "trade_in_submissions" DROP CONSTRAINT IF EXISTS "trade_in_submissions_deal_id_fkey";
ALTER TABLE "trade_in_submissions" DROP CONSTRAINT IF EXISTS "trade_in_submissions_vehicle_request_id_fkey";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_affiliate_id_fkey";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_assigned_admin_id_fkey";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_buyer_opportunity_id_fkey";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_current_plan_snapshot_fkey";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_inventory_item_id_fkey";
ALTER TABLE "vehicle_requests" DROP CONSTRAINT IF EXISTS "vehicle_requests_pre_qualification_id_fkey";

-- ── 4. indexes added to pre-existing tables ─────────────────────────────────────────────────────
DROP INDEX IF EXISTS "auction_invitations_auction_rooftop_key";
DROP INDEX IF EXISTS "auction_invitations_token_hash_key";
DROP INDEX IF EXISTS "auction_vehicles_vehicle_request_id_idx";
DROP INDEX IF EXISTS "audit_logs_legacy_path_write_idx";
DROP INDEX IF EXISTS "comms_outbox_recipient_idx";
DROP INDEX IF EXISTS "dealer_rooftops_mc_rooftop_id_key";
DROP INDEX IF EXISTS "deals_auction_id_idx";
DROP INDEX IF EXISTS "deals_current_plan_snapshot_idx";
DROP INDEX IF EXISTS "deals_dealer_id_idx";
DROP INDEX IF EXISTS "deals_vehicle_request_id_idx";
DROP INDEX IF EXISTS "deposits_vehicle_request_id_idx";
DROP INDEX IF EXISTS "e_sign_envelopes_deal_id_signer_kind_key";
DROP INDEX IF EXISTS "offers_auction_vehicle_id_idx";
DROP INDEX IF EXISTS "offers_one_live_per_rooftop_candidate_key";
DROP INDEX IF EXISTS "vehicle_requests_affiliate_id_idx";
DROP INDEX IF EXISTS "vehicle_requests_assigned_admin_id_idx";
DROP INDEX IF EXISTS "vehicle_requests_current_plan_snapshot_idx";
DROP INDEX IF EXISTS "vehicle_requests_inventory_item_id_idx";
DROP INDEX IF EXISTS "vehicle_requests_one_open_per_buyer_key";
DROP INDEX IF EXISTS "vehicle_requests_pre_qualification_id_idx";

-- ── 5. columns added to pre-existing tables (the four adopted tables included, by name only) ────
ALTER TABLE "affiliates"
  DROP COLUMN IF EXISTS "acquisition_channel",
  DROP COLUMN IF EXISTS "consent_ip",
  DROP COLUMN IF EXISTS "consent_ip_unavailable_reason",
  DROP COLUMN IF EXISTS "consent_surface",
  DROP COLUMN IF EXISTS "consent_text_hash",
  DROP COLUMN IF EXISTS "consent_version",
  DROP COLUMN IF EXISTS "ip_address",
  DROP COLUMN IF EXISTS "ip_unavailable_reason",
  DROP COLUMN IF EXISTS "referrer",
  DROP COLUMN IF EXISTS "source_url",
  DROP COLUMN IF EXISTS "utm_campaign",
  DROP COLUMN IF EXISTS "utm_content",
  DROP COLUMN IF EXISTS "utm_medium",
  DROP COLUMN IF EXISTS "utm_source";
ALTER TABLE "auction_invitations"
  DROP COLUMN IF EXISTS "bounced_at",
  DROP COLUMN IF EXISTS "candidate_ids",
  DROP COLUMN IF EXISTS "contact_name",
  DROP COLUMN IF EXISTS "dealership_name",
  DROP COLUMN IF EXISTS "declined_at",
  DROP COLUMN IF EXISTS "delivered_at",
  DROP COLUMN IF EXISTS "distance_miles",
  DROP COLUMN IF EXISTS "email",
  DROP COLUMN IF EXISTS "expires_at",
  DROP COLUMN IF EXISTS "is_registered_dealer",
  DROP COLUMN IF EXISTS "offer_submitted_at",
  DROP COLUMN IF EXISTS "opened_at",
  DROP COLUMN IF EXISTS "phone",
  DROP COLUMN IF EXISTS "queued_at",
  DROP COLUMN IF EXISTS "reminder_50_sent_at",
  DROP COLUMN IF EXISTS "reminder_90_sent_at",
  DROP COLUMN IF EXISTS "rooftop_id",
  DROP COLUMN IF EXISTS "status",
  DROP COLUMN IF EXISTS "token_hash";
ALTER TABLE "auction_vehicles"
  DROP COLUMN IF EXISTS "candidate_status",
  DROP COLUMN IF EXISTS "distance_miles",
  DROP COLUMN IF EXISTS "dropped_reason",
  DROP COLUMN IF EXISTS "listing_snapshot",
  DROP COLUMN IF EXISTS "revalidated_at",
  DROP COLUMN IF EXISTS "vehicle_request_id";
ALTER TABLE "auctions"
  DROP COLUMN IF EXISTS "sourcing_case_id";
ALTER TABLE "buyer_opportunities"
  DROP COLUMN IF EXISTS "acquisition_channel",
  DROP COLUMN IF EXISTS "affiliate_id",
  DROP COLUMN IF EXISTS "consent_ip",
  DROP COLUMN IF EXISTS "consent_ip_unavailable_reason",
  DROP COLUMN IF EXISTS "consent_surface",
  DROP COLUMN IF EXISTS "consent_text_hash",
  DROP COLUMN IF EXISTS "consent_version",
  DROP COLUMN IF EXISTS "ip_address",
  DROP COLUMN IF EXISTS "ip_unavailable_reason",
  DROP COLUMN IF EXISTS "referrer",
  DROP COLUMN IF EXISTS "source_url",
  DROP COLUMN IF EXISTS "utm_campaign",
  DROP COLUMN IF EXISTS "utm_content",
  DROP COLUMN IF EXISTS "utm_medium",
  DROP COLUMN IF EXISTS "utm_source";
ALTER TABLE "buyers"
  DROP COLUMN IF EXISTS "geocode_source",
  DROP COLUMN IF EXISTS "geocoded_at",
  DROP COLUMN IF EXISTS "latitude",
  DROP COLUMN IF EXISTS "longitude";
ALTER TABLE "circumvention_attempts"
  DROP COLUMN IF EXISTS "dealer_id";
ALTER TABLE "comms_outbox"
  DROP COLUMN IF EXISTS "auction_id",
  DROP COLUMN IF EXISTS "cancel_key",
  DROP COLUMN IF EXISTS "cancel_reason",
  DROP COLUMN IF EXISTS "cancelled_at",
  DROP COLUMN IF EXISTS "deal_id",
  DROP COLUMN IF EXISTS "delivered_at",
  DROP COLUMN IF EXISTS "max_attempts",
  DROP COLUMN IF EXISTS "next_attempt_at",
  DROP COLUMN IF EXISTS "recipient_id",
  DROP COLUMN IF EXISTS "recipient_kind",
  DROP COLUMN IF EXISTS "state_recheck",
  DROP COLUMN IF EXISTS "template_key",
  DROP COLUMN IF EXISTS "terminal_failed_at",
  DROP COLUMN IF EXISTS "trigger_event",
  DROP COLUMN IF EXISTS "vehicle_request_id";
ALTER TABLE "contract_versions"
  DROP COLUMN IF EXISTS "document_hash",
  DROP COLUMN IF EXISTS "executed_at",
  DROP COLUMN IF EXISTS "executed_document_hash",
  DROP COLUMN IF EXISTS "is_dealer_executed";
ALTER TABLE "dealer_applications"
  DROP COLUMN IF EXISTS "acquisition_channel",
  DROP COLUMN IF EXISTS "consent_ip",
  DROP COLUMN IF EXISTS "consent_ip_unavailable_reason",
  DROP COLUMN IF EXISTS "consent_surface",
  DROP COLUMN IF EXISTS "consent_text_hash",
  DROP COLUMN IF EXISTS "consent_version",
  DROP COLUMN IF EXISTS "ip_address",
  DROP COLUMN IF EXISTS "ip_unavailable_reason",
  DROP COLUMN IF EXISTS "referrer",
  DROP COLUMN IF EXISTS "source_url",
  DROP COLUMN IF EXISTS "utm_campaign",
  DROP COLUMN IF EXISTS "utm_content",
  DROP COLUMN IF EXISTS "utm_medium",
  DROP COLUMN IF EXISTS "utm_source";
ALTER TABLE "dealer_rooftops"
  DROP COLUMN IF EXISTS "mc_rooftop_id",
  DROP COLUMN IF EXISTS "operating_status",
  DROP COLUMN IF EXISTS "operating_status_checked_at";
ALTER TABLE "dealer_scorecard_snapshots"
  DROP COLUMN IF EXISTS "contract_delay_count",
  DROP COLUMN IF EXISTS "no_show_count",
  DROP COLUMN IF EXISTS "overdue_obligation_count",
  DROP COLUMN IF EXISTS "reaffirmation_failure_count";
ALTER TABLE "deals"
  DROP COLUMN IF EXISTS "auction_id",
  DROP COLUMN IF EXISTS "co_buyer_id",
  DROP COLUMN IF EXISTS "completed_at",
  DROP COLUMN IF EXISTS "condition_disclosure_acknowledged_at",
  DROP COLUMN IF EXISTS "current_plan_snapshot_id",
  DROP COLUMN IF EXISTS "dealer_executed_contract_id",
  DROP COLUMN IF EXISTS "dealer_id",
  DROP COLUMN IF EXISTS "deposit_id",
  DROP COLUMN IF EXISTS "down_payment_cents",
  DROP COLUMN IF EXISTS "fee_refund_reason",
  DROP COLUMN IF EXISTS "financing_completed_at",
  DROP COLUMN IF EXISTS "financing_terms_locked_at",
  DROP COLUMN IF EXISTS "frozen_at",
  DROP COLUMN IF EXISTS "frozen_reason",
  DROP COLUMN IF EXISTS "funding_cleared_at",
  DROP COLUMN IF EXISTS "hold_reason",
  DROP COLUMN IF EXISTS "odometer_at_offer",
  DROP COLUMN IF EXISTS "otd_cents_confirmed",
  DROP COLUMN IF EXISTS "pickup_ready_at",
  DROP COLUMN IF EXISTS "possession_confirmed_at",
  DROP COLUMN IF EXISTS "recap_confirmed_by_buyer_at",
  DROP COLUMN IF EXISTS "recap_confirmed_by_dealer_at",
  DROP COLUMN IF EXISTS "rooftop_id",
  DROP COLUMN IF EXISTS "vehicle_hold_until",
  DROP COLUMN IF EXISTS "vehicle_make",
  DROP COLUMN IF EXISTS "vehicle_model",
  DROP COLUMN IF EXISTS "vehicle_request_id",
  DROP COLUMN IF EXISTS "vehicle_trim",
  DROP COLUMN IF EXISTS "vehicle_year",
  DROP COLUMN IF EXISTS "vin";
ALTER TABLE "deposits"
  DROP COLUMN IF EXISTS "disclosures_accepted_at",
  DROP COLUMN IF EXISTS "disclosures_version",
  DROP COLUMN IF EXISTS "disputed_at",
  DROP COLUMN IF EXISTS "hold_reason",
  DROP COLUMN IF EXISTS "hold_released_at",
  DROP COLUMN IF EXISTS "refund_reason",
  DROP COLUMN IF EXISTS "vehicle_request_id";
ALTER TABLE "e_sign_envelopes"
  DROP COLUMN IF EXISTS "co_buyer_id",
  DROP COLUMN IF EXISTS "signer_kind";
ALTER TABLE "external_pre_approvals"
  DROP COLUMN IF EXISTS "deal_id";
ALTER TABLE "financing"
  DROP COLUMN IF EXISTS "completed_at",
  DROP COLUMN IF EXISTS "down_payment_cents",
  DROP COLUMN IF EXISTS "evidence_document_id",
  DROP COLUMN IF EXISTS "expires_at",
  DROP COLUMN IF EXISTS "external_reference",
  DROP COLUMN IF EXISTS "failure_reason",
  DROP COLUMN IF EXISTS "terms_locked_at",
  DROP COLUMN IF EXISTS "verified_at",
  DROP COLUMN IF EXISTS "verified_by";
ALTER TABLE "financing_audit_events"
  DROP COLUMN IF EXISTS "financing_id";
ALTER TABLE "insurance_policies"
  DROP COLUMN IF EXISTS "covers_co_buyer",
  DROP COLUMN IF EXISTS "rejection_reason",
  DROP COLUMN IF EXISTS "reviewed_at",
  DROP COLUMN IF EXISTS "reviewed_by",
  DROP COLUMN IF EXISTS "vin";
ALTER TABLE "inventory_items"
  DROP COLUMN IF EXISTS "days_on_lot",
  DROP COLUMN IF EXISTS "external_dealer_website",
  DROP COLUMN IF EXISTS "listing_id",
  DROP COLUMN IF EXISTS "mc_category",
  DROP COLUMN IF EXISTS "mc_location_id",
  DROP COLUMN IF EXISTS "mc_website_id",
  DROP COLUMN IF EXISTS "provider_last_seen_at";
ALTER TABLE "offers"
  DROP COLUMN IF EXISTS "add_on_items",
  DROP COLUMN IF EXISTS "auction_vehicle_id",
  DROP COLUMN IF EXISTS "availability_confirmed",
  DROP COLUMN IF EXISTS "availability_confirmed_at",
  DROP COLUMN IF EXISTS "can_complete_sale_confirmed",
  DROP COLUMN IF EXISTS "condition_report_url",
  DROP COLUMN IF EXISTS "delivery_fee_cents",
  DROP COLUMN IF EXISTS "delivery_terms",
  DROP COLUMN IF EXISTS "disqualified_reason",
  DROP COLUMN IF EXISTS "doc_fee_cents",
  DROP COLUMN IF EXISTS "expires_at",
  DROP COLUMN IF EXISTS "exterior_color",
  DROP COLUMN IF EXISTS "incentive_items",
  DROP COLUMN IF EXISTS "interior_color",
  DROP COLUMN IF EXISTS "is_disqualified",
  DROP COLUMN IF EXISTS "odometer",
  DROP COLUMN IF EXISTS "out_of_state_registration_supported",
  DROP COLUMN IF EXISTS "photo_urls",
  DROP COLUMN IF EXISTS "required_feature_matches",
  DROP COLUMN IF EXISTS "required_feature_mismatches",
  DROP COLUMN IF EXISTS "rooftop_id",
  DROP COLUMN IF EXISTS "stock_number",
  DROP COLUMN IF EXISTS "title_registration_cents",
  DROP COLUMN IF EXISTS "vehicle_condition",
  DROP COLUMN IF EXISTS "vehicle_history_report_url",
  DROP COLUMN IF EXISTS "vehicle_make",
  DROP COLUMN IF EXISTS "vehicle_model",
  DROP COLUMN IF EXISTS "vehicle_trim",
  DROP COLUMN IF EXISTS "vehicle_year",
  DROP COLUMN IF EXISTS "vin";
ALTER TABLE "payment_provider_events"
  DROP COLUMN IF EXISTS "disputed_at",
  DROP COLUMN IF EXISTS "processing_at",
  DROP COLUMN IF EXISTS "reconciliation_pending_at";
ALTER TABLE "pickups"
  DROP COLUMN IF EXISTS "buyer_confirmed_at",
  DROP COLUMN IF EXISTS "condition_at_release",
  DROP COLUMN IF EXISTS "dealer_readiness_checklist",
  DROP COLUMN IF EXISTS "dealer_released_at",
  DROP COLUMN IF EXISTS "delivery_address",
  DROP COLUMN IF EXISTS "due_bill_items",
  DROP COLUMN IF EXISTS "fulfillment_mode",
  DROP COLUMN IF EXISTS "funds_collected_method",
  DROP COLUMN IF EXISTS "identity_verified_at",
  DROP COLUMN IF EXISTS "no_show_at",
  DROP COLUMN IF EXISTS "no_show_party",
  DROP COLUMN IF EXISTS "odometer_at_possession",
  DROP COLUMN IF EXISTS "odometer_at_release",
  DROP COLUMN IF EXISTS "possession_discrepancy",
  DROP COLUMN IF EXISTS "readiness_confirmed_at",
  DROP COLUMN IF EXISTS "released_by",
  DROP COLUMN IF EXISTS "reminder_24h_sent_at",
  DROP COLUMN IF EXISTS "reminder_2h_sent_at",
  DROP COLUMN IF EXISTS "token_consumed_at",
  DROP COLUMN IF EXISTS "token_expires_at",
  DROP COLUMN IF EXISTS "token_hash",
  DROP COLUMN IF EXISTS "token_revoked_at",
  DROP COLUMN IF EXISTS "trade_received_at",
  DROP COLUMN IF EXISTS "vehicle_prepared_at",
  DROP COLUMN IF EXISTS "vin_match";
ALTER TABLE "refinance_applications"
  DROP COLUMN IF EXISTS "consent_ip",
  DROP COLUMN IF EXISTS "consent_ip_unavailable_reason",
  DROP COLUMN IF EXISTS "consent_surface",
  DROP COLUMN IF EXISTS "consent_text_hash",
  DROP COLUMN IF EXISTS "consent_version",
  DROP COLUMN IF EXISTS "interested_in_buying",
  DROP COLUMN IF EXISTS "partner_outcome",
  DROP COLUMN IF EXISTS "partner_outcome_at",
  DROP COLUMN IF EXISTS "partner_reference";
ALTER TABLE "shortlist_items"
  DROP COLUMN IF EXISTS "distance_miles";
ALTER TABLE "trade_in_submissions"
  DROP COLUMN IF EXISTS "appraisal_changed_at",
  DROP COLUMN IF EXISTS "bringing_to_pickup",
  DROP COLUMN IF EXISTS "deal_id",
  DROP COLUMN IF EXISTS "final_allowance_cents",
  DROP COLUMN IF EXISTS "has_second_key",
  DROP COLUMN IF EXISTS "lienholder_name",
  DROP COLUMN IF EXISTS "payoff_good_through_date",
  DROP COLUMN IF EXISTS "photo_urls",
  DROP COLUMN IF EXISTS "preliminary_allowance_cents",
  DROP COLUMN IF EXISTS "share_consent_at",
  DROP COLUMN IF EXISTS "title_in_hand",
  DROP COLUMN IF EXISTS "title_state",
  DROP COLUMN IF EXISTS "vehicle_request_id",
  DROP COLUMN IF EXISTS "verified_payoff_cents";
ALTER TABLE "vehicle_requests"
  DROP COLUMN IF EXISTS "abandoned_at",
  DROP COLUMN IF EXISTS "acquisition_channel",
  DROP COLUMN IF EXISTS "affiliate_id",
  DROP COLUMN IF EXISTS "authorized_max_radius_miles",
  DROP COLUMN IF EXISTS "body_type",
  DROP COLUMN IF EXISTS "city",
  DROP COLUMN IF EXISTS "co_buyer_elected",
  DROP COLUMN IF EXISTS "condition_preference",
  DROP COLUMN IF EXISTS "consent_ip",
  DROP COLUMN IF EXISTS "consent_ip_unavailable_reason",
  DROP COLUMN IF EXISTS "consent_surface",
  DROP COLUMN IF EXISTS "consent_text_hash",
  DROP COLUMN IF EXISTS "consent_version",
  DROP COLUMN IF EXISTS "current_plan_snapshot_id",
  DROP COLUMN IF EXISTS "delivery_preference",
  DROP COLUMN IF EXISTS "disclosures_accepted_at",
  DROP COLUMN IF EXISTS "disclosures_version",
  DROP COLUMN IF EXISTS "down_payment_cents",
  DROP COLUMN IF EXISTS "drivetrain",
  DROP COLUMN IF EXISTS "entry_type",
  DROP COLUMN IF EXISTS "expected_down_payment_cents",
  DROP COLUMN IF EXISTS "exterior_colors",
  DROP COLUMN IF EXISTS "interior_colors",
  DROP COLUMN IF EXISTS "inventory_item_id",
  DROP COLUMN IF EXISTS "ip_unavailable_reason",
  DROP COLUMN IF EXISTS "latitude",
  DROP COLUMN IF EXISTS "longitude",
  DROP COLUMN IF EXISTS "max_mileage",
  DROP COLUMN IF EXISTS "pre_qualification_id",
  DROP COLUMN IF EXISTS "preferred_features",
  DROP COLUMN IF EXISTS "purchase_timeframe",
  DROP COLUMN IF EXISTS "radius_authorization_requested_at",
  DROP COLUMN IF EXISTS "required_features",
  DROP COLUMN IF EXISTS "state",
  DROP COLUMN IF EXISTS "stated_budget_cents",
  DROP COLUMN IF EXISTS "utm_content",
  DROP COLUMN IF EXISTS "zip";

-- ── 6. tables the wave created — one statement so mutual foreign keys need no ordering ──────────
DROP TABLE IF EXISTS
  "co_buyers",
  "deal_corrections",
  "deal_recaps",
  "dealer_reaffirmations",
  "inventory_query_cache",
  "plan_snapshots",
  "post_completion_obligations",
  "queue_items",
  "sourcing_candidates",
  "sourcing_cases";

-- ── 7. enum types the wave created ──────────────────────────────────────────────────────────────
DROP TYPE IF EXISTS "AuctionInvitationStatus";
DROP TYPE IF EXISTS "AuctionVehicleCandidateStatus";
DROP TYPE IF EXISTS "DealerReaffirmationStatus";
DROP TYPE IF EXISTS "DeliveryPreference";
DROP TYPE IF EXISTS "ESignSignerKind";
DROP TYPE IF EXISTS "PostCompletionObligationStatus";
DROP TYPE IF EXISTS "QueueOwnerRole";
DROP TYPE IF EXISTS "SourcingCandidateSource";
DROP TYPE IF EXISTS "VehicleRequestEntryType";

-- ── 8. prove the deny-list held ─────────────────────────────────────────────────────────────────
DO $$
DECLARE missing text;
BEGIN
  SELECT string_agg(t, ', ') INTO missing
  FROM unnest(ARRAY['comms_outbox','lifecycle_touch_schedule','idempotency_keys','jobs_dead_letter']) t
  WHERE to_regclass('public.' || quote_ident(t)) IS NULL;
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'rollback.sql dropped an ADOPTED table it must never touch: %', missing;
  END IF;
END $$;

COMMIT;
