-- Phase 1 wave, directory 2 of 2 — TABLES, COLUMNS, INDEXES, CONSTRAINTS, TRIGGERS.
--
-- THIS IS A PROOF COPY. It deliberately does NOT live in frontend/prisma/migrations/, because
-- Phase 1 has not been authorised to begin. It exists to prove the §8.2 statements apply in order to
-- an isolated PostgreSQL 17.6 database, produce every expected object, and succeed unchanged on a
-- second application.
--
-- It is free to name the labels directory 1 committed. Every statement is guarded, so re-applying the
-- complete pair is a no-op. No statement uses CREATE INDEX CONCURRENTLY: Prisma runs each migration
-- file inside one transaction, where CONCURRENTLY is illegal.
--
-- Where §8.2 enumerates a value set, this file uses an enum; where it names a field without
-- enumerating its values (sourcing case status, co-buyer role, obligation type, correction kind),
-- it uses text with a CHECK or no constraint rather than inventing labels the plan has not decided.
--
-- OWNER-GATED statements are marked. Each is a single guarded statement that can be deleted without
-- reordering anything else.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. NEW ENUM TYPES  (safe here: a type created in this transaction may also be used in it)
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF to_regtype('"VehicleRequestEntryType"') IS NULL THEN
    CREATE TYPE "VehicleRequestEntryType" AS ENUM ('INVENTORY_SELECTION', 'CUSTOM_REQUEST');
  END IF;
  IF to_regtype('"DeliveryPreference"') IS NULL THEN
    CREATE TYPE "DeliveryPreference" AS ENUM ('PICKUP', 'DELIVERY');
  END IF;
  IF to_regtype('"AuctionInvitationStatus"') IS NULL THEN
    CREATE TYPE "AuctionInvitationStatus" AS ENUM (
      'QUEUED','SENT','DELIVERED','OPENED','BOUNCED','DECLINED','RESPONDED','OFFER_SUBMITTED','EXPIRED','REPLACED');
  END IF;
  IF to_regtype('"DealerReaffirmationStatus"') IS NULL THEN
    CREATE TYPE "DealerReaffirmationStatus" AS ENUM (
      'PENDING','CONFIRMED','REJECTED','TIMED_OUT','MATERIAL_CHANGE_PENDING');
  END IF;
  IF to_regtype('"PostCompletionObligationStatus"') IS NULL THEN
    CREATE TYPE "PostCompletionObligationStatus" AS ENUM ('PENDING','OVERDUE','RESOLVED');
  END IF;
  IF to_regtype('"AuctionVehicleCandidateStatus"') IS NULL THEN
    CREATE TYPE "AuctionVehicleCandidateStatus" AS ENUM (
      'ACTIVE','DROPPED','SELECTED','CLOSED','REVALIDATION_PENDING');
  END IF;
  IF to_regtype('"ESignSignerKind"') IS NULL THEN
    CREATE TYPE "ESignSignerKind" AS ENUM ('BUYER','CO_BUYER');
  END IF;
  IF to_regtype('"SourcingCandidateSource"') IS NULL THEN
    CREATE TYPE "SourcingCandidateSource" AS ENUM ('HOLDING','COMPARABLE');
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. NEW TABLES THAT OTHER OBJECTS REFERENCE  (created before the columns that point at them)
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- §23 plan lineage. Lineage columns here; the "currently governing" pointers live on
-- vehicle_requests / deals. All four are nullable and snapshots are written first (§8.2 rule-10 note).
CREATE TABLE IF NOT EXISTS "plan_snapshots" (
  "id"                     TEXT PRIMARY KEY,
  "buyer_id"               TEXT NOT NULL,
  "vehicle_request_id"     TEXT,
  "deal_id"                TEXT,
  "plan"                   "BuyerPlan" NOT NULL,
  "effective_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actor"                  TEXT,
  "touchpoint"             TEXT,
  "settled_deposit_cents"  INTEGER,
  "settled_premium_cents"  INTEGER,
  "reason"                 TEXT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- §5a co-buyer. Master rule 10: the child owns the physical key, so vehicle_request_id lives here and
-- vehicle_requests exposes the reverse as an ORM relation, never a reciprocal column.
CREATE TABLE IF NOT EXISTS "co_buyers" (
  "id"                        TEXT PRIMARY KEY,
  "buyer_id"                  TEXT NOT NULL,
  "vehicle_request_id"        TEXT,
  "legal_first_name"          TEXT,
  "legal_last_name"           TEXT,
  "email"                     TEXT,
  "phone"                     TEXT,
  "address"                   TEXT,
  "city"                      TEXT,
  "state"                     TEXT,
  "zip"                       TEXT,
  "role"                      TEXT,
  "requested_by_primary_at"   TIMESTAMP(3),
  "share_consent_at"          TIMESTAMP(3),
  "share_consent_version"     TEXT,
  "is_required_signer"        BOOLEAN NOT NULL DEFAULT false,
  "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- §6b/§6c sourcing ladder — the band/authorisation state that today has no store.
CREATE TABLE IF NOT EXISTS "sourcing_cases" (
  "id"                            TEXT PRIMARY KEY,
  "vehicle_request_id"            TEXT NOT NULL,
  "status"                        TEXT NOT NULL,
  "band"                          TEXT NOT NULL DEFAULT '100',
  "opened_at"                     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "band_expanded_at"              TIMESTAMP(3),
  "authorization_requested_at"    TIMESTAMP(3),
  "authorized_radius_miles"       INTEGER,
  "coverage_count"                INTEGER NOT NULL DEFAULT 0,
  "limited_auction_approved_by"   TEXT,
  "limited_auction_approved_at"   TIMESTAMP(3),
  "closed_at"                     TIMESTAMP(3),
  "close_reason"                  TEXT,
  "created_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "sourcing_cases_band_check" CHECK ("band" IN ('100','150','250','AUTHORIZED'))
);

CREATE TABLE IF NOT EXISTS "sourcing_candidates" (
  "id"                    TEXT PRIMARY KEY,
  "sourcing_case_id"      TEXT NOT NULL,
  "rooftop_id"            TEXT,
  "source"                "SourcingCandidateSource" NOT NULL,
  "distance_miles"        DOUBLE PRECISION,
  "served_candidate_ids"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "validation"            JSONB,
  "invited_at"            TIMESTAMP(3),
  "excluded_reason"       TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. COLUMNS ON EXISTING TABLES  (all nullable, or NOT NULL with a default — never a bare NOT NULL)
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- ── vehicle_requests: the fulfilment record (§4.1, §5, §22a, §28.2) ─────────────────────────────
ALTER TABLE "vehicle_requests"
  ADD COLUMN IF NOT EXISTS "entry_type"                        "VehicleRequestEntryType",
  ADD COLUMN IF NOT EXISTS "inventory_item_id"                 TEXT,
  ADD COLUMN IF NOT EXISTS "pre_qualification_id"              TEXT,
  ADD COLUMN IF NOT EXISTS "plan_snapshot_id"                  TEXT,
  ADD COLUMN IF NOT EXISTS "city"                              TEXT,
  ADD COLUMN IF NOT EXISTS "state"                             TEXT,
  ADD COLUMN IF NOT EXISTS "zip"                               TEXT,
  ADD COLUMN IF NOT EXISTS "latitude"                          DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "longitude"                         DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "authorized_max_radius_miles"       INTEGER,
  ADD COLUMN IF NOT EXISTS "down_payment_cents"                INTEGER,
  ADD COLUMN IF NOT EXISTS "delivery_preference"               "DeliveryPreference",
  ADD COLUMN IF NOT EXISTS "body_type"                         TEXT,
  ADD COLUMN IF NOT EXISTS "drivetrain"                        TEXT,
  ADD COLUMN IF NOT EXISTS "exterior_colors"                   TEXT[],
  ADD COLUMN IF NOT EXISTS "interior_colors"                   TEXT[],
  ADD COLUMN IF NOT EXISTS "max_mileage"                       INTEGER,
  ADD COLUMN IF NOT EXISTS "condition_preference"              TEXT,
  ADD COLUMN IF NOT EXISTS "required_features"                 TEXT[],
  ADD COLUMN IF NOT EXISTS "preferred_features"                TEXT[],
  ADD COLUMN IF NOT EXISTS "purchase_timeframe"                TEXT,
  ADD COLUMN IF NOT EXISTS "radius_authorization_requested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "abandoned_at"                      TIMESTAMP(3),
  -- intake & attribution (folded in from §10 area intake)
  ADD COLUMN IF NOT EXISTS "acquisition_channel"               TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS "utm_content"                       TEXT,
  ADD COLUMN IF NOT EXISTS "affiliate_id"                      TEXT,
  ADD COLUMN IF NOT EXISTS "consent_version"                   TEXT,
  ADD COLUMN IF NOT EXISTS "consent_text_hash"                 TEXT,
  ADD COLUMN IF NOT EXISTS "consent_ip"                        TEXT,
  ADD COLUMN IF NOT EXISTS "consent_surface"                   TEXT,
  ADD COLUMN IF NOT EXISTS "stated_budget_cents"               INTEGER,
  ADD COLUMN IF NOT EXISTS "expected_down_payment_cents"       INTEGER,
  ADD COLUMN IF NOT EXISTS "co_buyer_elected"                  BOOLEAN;

-- ── deposits (§3 rule 10, §23, §26 dispute) ─────────────────────────────────────────────────────
ALTER TABLE "deposits"
  ADD COLUMN IF NOT EXISTS "vehicle_request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "disputed_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refund_reason"      "RefundReason";

-- ── deals: lineage, vehicle snapshot, checkpoint timestamps (§32) ───────────────────────────────
ALTER TABLE "deals"
  ADD COLUMN IF NOT EXISTS "vehicle_request_id"                    TEXT,
  ADD COLUMN IF NOT EXISTS "auction_id"                            TEXT,
  ADD COLUMN IF NOT EXISTS "deposit_id"                            TEXT,
  ADD COLUMN IF NOT EXISTS "dealer_id"                             TEXT,
  ADD COLUMN IF NOT EXISTS "rooftop_id"                            TEXT,
  ADD COLUMN IF NOT EXISTS "vin"                                   TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_year"                          INTEGER,
  ADD COLUMN IF NOT EXISTS "vehicle_make"                          TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_model"                         TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_trim"                          TEXT,
  ADD COLUMN IF NOT EXISTS "odometer_at_offer"                     INTEGER,
  ADD COLUMN IF NOT EXISTS "co_buyer_id"                           TEXT,
  ADD COLUMN IF NOT EXISTS "otd_cents_confirmed"                   INTEGER,
  ADD COLUMN IF NOT EXISTS "down_payment_cents"                    INTEGER,
  ADD COLUMN IF NOT EXISTS "plan_snapshot_id"                      TEXT,
  ADD COLUMN IF NOT EXISTS "recap_confirmed_by_buyer_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "recap_confirmed_by_dealer_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "vehicle_hold_until"                    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "condition_disclosure_acknowledged_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "financing_terms_locked_at"             TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "financing_completed_at"                TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "funding_cleared_at"                    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dealer_executed_contract_id"           TEXT,
  ADD COLUMN IF NOT EXISTS "pickup_ready_at"                       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "possession_confirmed_at"               TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_at"                          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "frozen_at"                             TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "frozen_reason"                         TEXT,
  ADD COLUMN IF NOT EXISTS "hold_reason"                           TEXT;

-- ── offers: candidate binding, vehicle identity, itemised money, evidence (§22a) ────────────────
ALTER TABLE "offers"
  ADD COLUMN IF NOT EXISTS "auction_vehicle_id"                    TEXT,
  ADD COLUMN IF NOT EXISTS "vin"                                   TEXT,
  ADD COLUMN IF NOT EXISTS "stock_number"                          TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_year"                          INTEGER,
  ADD COLUMN IF NOT EXISTS "vehicle_make"                          TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_model"                         TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_trim"                          TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_condition"                     TEXT,
  ADD COLUMN IF NOT EXISTS "odometer"                              INTEGER,
  ADD COLUMN IF NOT EXISTS "exterior_color"                        TEXT,
  ADD COLUMN IF NOT EXISTS "interior_color"                        TEXT,
  ADD COLUMN IF NOT EXISTS "availability_confirmed"                BOOLEAN,
  ADD COLUMN IF NOT EXISTS "doc_fee_cents"                         INTEGER,
  ADD COLUMN IF NOT EXISTS "title_registration_cents"              INTEGER,
  ADD COLUMN IF NOT EXISTS "add_on_items"                          JSONB,
  ADD COLUMN IF NOT EXISTS "incentive_items"                       JSONB,
  ADD COLUMN IF NOT EXISTS "delivery_terms"                        TEXT,
  ADD COLUMN IF NOT EXISTS "delivery_fee_cents"                    INTEGER,
  ADD COLUMN IF NOT EXISTS "out_of_state_registration_supported"   BOOLEAN,
  ADD COLUMN IF NOT EXISTS "expires_at"                            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "required_feature_matches"              JSONB,
  ADD COLUMN IF NOT EXISTS "required_feature_mismatches"           JSONB,
  ADD COLUMN IF NOT EXISTS "condition_report_url"                  TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_history_report_url"            TEXT,
  ADD COLUMN IF NOT EXISTS "photo_urls"                            TEXT[],
  ADD COLUMN IF NOT EXISTS "can_complete_sale_confirmed"           BOOLEAN,
  ADD COLUMN IF NOT EXISTS "rooftop_id"                            TEXT,
  ADD COLUMN IF NOT EXISTS "is_disqualified"                       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "disqualified_reason"                   TEXT;

-- ── auction_invitations: consolidated invitation record (§6, §7) ────────────────────────────────
ALTER TABLE "auction_invitations"
  ADD COLUMN IF NOT EXISTS "rooftop_id"           TEXT,
  ADD COLUMN IF NOT EXISTS "dealership_name"      TEXT,
  ADD COLUMN IF NOT EXISTS "contact_name"         TEXT,
  ADD COLUMN IF NOT EXISTS "email"                TEXT,
  ADD COLUMN IF NOT EXISTS "phone"                TEXT,
  ADD COLUMN IF NOT EXISTS "token_hash"           TEXT,
  ADD COLUMN IF NOT EXISTS "expires_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "status"               "AuctionInvitationStatus" NOT NULL DEFAULT 'QUEUED',
  ADD COLUMN IF NOT EXISTS "queued_at"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "delivered_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "opened_at"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "bounced_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "declined_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "offer_submitted_at"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "is_registered_dealer" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "candidate_ids"        TEXT[],
  ADD COLUMN IF NOT EXISTS "distance_miles"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "reminder_50_sent_at"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reminder_90_sent_at"  TIMESTAMP(3);

-- A consolidated invitation can name an unregistered rooftop, so the dealer link becomes optional.
-- `outside_auction_invites` is NOT dropped — it stays a legacy read path (§8.4).
ALTER TABLE "auction_invitations" ALTER COLUMN "dealer_id" DROP NOT NULL;

-- ── auction_vehicles: candidates (§22a) ─────────────────────────────────────────────────────────
ALTER TABLE "auction_vehicles"
  ADD COLUMN IF NOT EXISTS "vehicle_request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "distance_miles"     DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "candidate_status"   "AuctionVehicleCandidateStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS "listing_snapshot"   JSONB,
  ADD COLUMN IF NOT EXISTS "revalidated_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dropped_reason"     TEXT;

-- ── auctions: the ladder that produced them ─────────────────────────────────────────────────────
ALTER TABLE "auctions" ADD COLUMN IF NOT EXISTS "sourcing_case_id" TEXT;

-- ── financing (§12b) ────────────────────────────────────────────────────────────────────────────
ALTER TABLE "financing"
  ADD COLUMN IF NOT EXISTS "down_payment_cents"    INTEGER,
  ADD COLUMN IF NOT EXISTS "external_reference"    TEXT,
  ADD COLUMN IF NOT EXISTS "evidence_document_id"  TEXT,
  ADD COLUMN IF NOT EXISTS "terms_locked_at"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "completed_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verified_by"           TEXT,
  ADD COLUMN IF NOT EXISTS "verified_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expires_at"            TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "failure_reason"        TEXT;

ALTER TABLE "external_pre_approvals" ADD COLUMN IF NOT EXISTS "deal_id" TEXT;

-- ── insurance (§15) ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "insurance_policies"
  ADD COLUMN IF NOT EXISTS "rejection_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_by"      TEXT,
  ADD COLUMN IF NOT EXISTS "reviewed_at"      TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "covers_co_buyer"  BOOLEAN,
  ADD COLUMN IF NOT EXISTS "vin"              TEXT;

-- ── pickups (§16–§19) ───────────────────────────────────────────────────────────────────────────
ALTER TABLE "pickups"
  ADD COLUMN IF NOT EXISTS "readiness_confirmed_at"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "token_hash"                 TEXT,
  ADD COLUMN IF NOT EXISTS "token_expires_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "token_consumed_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "token_revoked_at"           TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dealer_released_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "released_by"                TEXT,
  ADD COLUMN IF NOT EXISTS "odometer_at_release"        INTEGER,
  ADD COLUMN IF NOT EXISTS "condition_at_release"       TEXT,
  ADD COLUMN IF NOT EXISTS "buyer_confirmed_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "funds_collected_method"     TEXT,
  ADD COLUMN IF NOT EXISTS "due_bill_items"             JSONB,
  ADD COLUMN IF NOT EXISTS "reminder_24h_sent_at"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reminder_2h_sent_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "identity_verified_at"       TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "trade_received_at"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "delivery_address"           TEXT,
  -- folded in from §10 area pickup
  ADD COLUMN IF NOT EXISTS "fulfillment_mode"           TEXT,
  ADD COLUMN IF NOT EXISTS "no_show_party"              TEXT,
  ADD COLUMN IF NOT EXISTS "no_show_at"                 TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "vehicle_prepared_at"        TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "dealer_readiness_checklist" JSONB,
  ADD COLUMN IF NOT EXISTS "odometer_at_possession"     INTEGER,
  ADD COLUMN IF NOT EXISTS "vin_match"                  BOOLEAN,
  ADD COLUMN IF NOT EXISTS "possession_discrepancy"     JSONB;

-- ── trade-in (§19a) ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "trade_in_submissions"
  ADD COLUMN IF NOT EXISTS "vehicle_request_id"           TEXT,
  ADD COLUMN IF NOT EXISTS "deal_id"                      TEXT,
  ADD COLUMN IF NOT EXISTS "lienholder_name"              TEXT,
  ADD COLUMN IF NOT EXISTS "payoff_good_through_date"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "title_in_hand"                BOOLEAN,
  ADD COLUMN IF NOT EXISTS "title_state"                  TEXT,
  ADD COLUMN IF NOT EXISTS "has_second_key"               BOOLEAN,
  ADD COLUMN IF NOT EXISTS "photo_urls"                   TEXT[],
  ADD COLUMN IF NOT EXISTS "bringing_to_pickup"           BOOLEAN,
  ADD COLUMN IF NOT EXISTS "preliminary_allowance_cents"  INTEGER,
  ADD COLUMN IF NOT EXISTS "verified_payoff_cents"        INTEGER,
  ADD COLUMN IF NOT EXISTS "share_consent_at"             TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "appraisal_changed_at"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "final_allowance_cents"        INTEGER;

-- ── contracts & e-sign (§13, §14) ───────────────────────────────────────────────────────────────
ALTER TABLE "contract_versions"
  ADD COLUMN IF NOT EXISTS "document_hash"           TEXT,
  ADD COLUMN IF NOT EXISTS "is_dealer_executed"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "executed_at"             TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "executed_document_hash"  TEXT;

ALTER TABLE "e_sign_envelopes"
  ADD COLUMN IF NOT EXISTS "signer_kind" "ESignSignerKind" NOT NULL DEFAULT 'BUYER',
  ADD COLUMN IF NOT EXISTS "co_buyer_id" TEXT;

-- ── buyers, leads, dealers, scorecards, payments, audit trail (folded in from §10) ──────────────
ALTER TABLE "buyers"
  ADD COLUMN IF NOT EXISTS "latitude"       DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "longitude"      DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "geocoded_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "geocode_source" TEXT;

ALTER TABLE "buyer_opportunities"
  ADD COLUMN IF NOT EXISTS "acquisition_channel" TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS "utm_source"          TEXT,
  ADD COLUMN IF NOT EXISTS "utm_medium"          TEXT,
  ADD COLUMN IF NOT EXISTS "utm_campaign"        TEXT,
  ADD COLUMN IF NOT EXISTS "utm_content"         TEXT,
  ADD COLUMN IF NOT EXISTS "referrer"            TEXT,
  ADD COLUMN IF NOT EXISTS "source_url"          TEXT,
  ADD COLUMN IF NOT EXISTS "ip_address"          TEXT,
  ADD COLUMN IF NOT EXISTS "affiliate_id"        TEXT,
  ADD COLUMN IF NOT EXISTS "consent_version"     TEXT,
  ADD COLUMN IF NOT EXISTS "consent_text_hash"   TEXT,
  ADD COLUMN IF NOT EXISTS "consent_ip"          TEXT,
  ADD COLUMN IF NOT EXISTS "consent_surface"     TEXT;

-- Lane 2–4 attribution & consent (N1): the two submission records that carry neither today.
ALTER TABLE "dealer_applications"
  ADD COLUMN IF NOT EXISTS "acquisition_channel" TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS "utm_source"          TEXT,
  ADD COLUMN IF NOT EXISTS "utm_medium"          TEXT,
  ADD COLUMN IF NOT EXISTS "utm_campaign"        TEXT,
  ADD COLUMN IF NOT EXISTS "utm_content"         TEXT,
  ADD COLUMN IF NOT EXISTS "referrer"            TEXT,
  ADD COLUMN IF NOT EXISTS "source_url"          TEXT,
  ADD COLUMN IF NOT EXISTS "ip_address"          TEXT,
  ADD COLUMN IF NOT EXISTS "consent_version"     TEXT,
  ADD COLUMN IF NOT EXISTS "consent_text_hash"   TEXT,
  ADD COLUMN IF NOT EXISTS "consent_ip"          TEXT,
  ADD COLUMN IF NOT EXISTS "consent_surface"     TEXT;

ALTER TABLE "affiliates"
  ADD COLUMN IF NOT EXISTS "acquisition_channel" TEXT NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS "utm_source"          TEXT,
  ADD COLUMN IF NOT EXISTS "utm_medium"          TEXT,
  ADD COLUMN IF NOT EXISTS "utm_campaign"        TEXT,
  ADD COLUMN IF NOT EXISTS "utm_content"         TEXT,
  ADD COLUMN IF NOT EXISTS "referrer"            TEXT,
  ADD COLUMN IF NOT EXISTS "source_url"          TEXT,
  ADD COLUMN IF NOT EXISTS "ip_address"          TEXT,
  ADD COLUMN IF NOT EXISTS "consent_version"     TEXT,
  ADD COLUMN IF NOT EXISTS "consent_text_hash"   TEXT,
  ADD COLUMN IF NOT EXISTS "consent_ip"          TEXT,
  ADD COLUMN IF NOT EXISTS "consent_surface"     TEXT;

ALTER TABLE "refinance_applications"
  ADD COLUMN IF NOT EXISTS "interested_in_buying" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "consent_version"      TEXT,
  ADD COLUMN IF NOT EXISTS "consent_text_hash"    TEXT,
  ADD COLUMN IF NOT EXISTS "consent_ip"           TEXT,
  ADD COLUMN IF NOT EXISTS "consent_surface"      TEXT;

-- OWNER-GATED (R34 — pending the OpenRoad reconciliation-key confirmation). Omittable as a unit.
ALTER TABLE "refinance_applications"
  ADD COLUMN IF NOT EXISTS "partner_reference"  TEXT,
  ADD COLUMN IF NOT EXISTS "partner_outcome"    TEXT,
  ADD COLUMN IF NOT EXISTS "partner_outcome_at" TIMESTAMP(3);

ALTER TABLE "payment_provider_events"
  ADD COLUMN IF NOT EXISTS "processing_at"              TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "disputed_at"                TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reconciliation_pending_at"  TIMESTAMP(3);

ALTER TABLE "financing_audit_events"
  ADD COLUMN IF NOT EXISTS "financing_id" TEXT;

ALTER TABLE "dealer_scorecard_snapshots"
  ADD COLUMN IF NOT EXISTS "reaffirmation_failure_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "no_show_count"               INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "contract_delay_count"        INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "overdue_obligation_count"    INTEGER NOT NULL DEFAULT 0;

-- §25.2 — a dealer-initiated circumvention attempt is recorded against the dealer, not only the buyer.
ALTER TABLE "circumvention_attempts" ADD COLUMN IF NOT EXISTS "dealer_id" TEXT;

-- ── inventory & rooftops (§22a, §6b validation) ─────────────────────────────────────────────────
ALTER TABLE "inventory_items"
  ADD COLUMN IF NOT EXISTS "listing_id"               TEXT,
  ADD COLUMN IF NOT EXISTS "provider_last_seen_at"    TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "days_on_lot"              INTEGER,
  ADD COLUMN IF NOT EXISTS "mc_website_id"            TEXT,
  ADD COLUMN IF NOT EXISTS "mc_location_id"           TEXT,
  ADD COLUMN IF NOT EXISTS "mc_category"              TEXT,
  ADD COLUMN IF NOT EXISTS "external_dealer_website"  TEXT;

ALTER TABLE "dealer_rooftops"
  ADD COLUMN IF NOT EXISTS "mc_rooftop_id"                TEXT,
  ADD COLUMN IF NOT EXISTS "operating_status"             TEXT,
  ADD COLUMN IF NOT EXISTS "operating_status_checked_at"  TIMESTAMP(3);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 4. REMAINING NEW TABLES
-- ════════════════════════════════════════════════════════════════════════════════════════════════

-- §10 dealer reaffirmation.
CREATE TABLE IF NOT EXISTS "dealer_reaffirmations" (
  "id"                                TEXT PRIMARY KEY,
  "deal_id"                           TEXT NOT NULL,
  "dealer_id"                         TEXT,
  "status"                            "DealerReaffirmationStatus" NOT NULL DEFAULT 'PENDING',
  "confirmed_vin"                     TEXT,
  "confirmed_odometer"                INTEGER,
  "confirmed_otd_cents"               INTEGER,
  "confirmed_fee_items"               JSONB,
  "confirmed_incentive_items"         JSONB,
  "confirmed_add_on_items"            JSONB,
  "confirmed_delivery_terms"          TEXT,
  "out_of_state_handling"             TEXT,
  "trade_subject_to_appraisal_ack"    BOOLEAN,
  "hold_until"                        TIMESTAMP(3),
  "disclosure_artifact_urls"          TEXT[],
  "buyer_acknowledged_at"             TIMESTAMP(3),
  "material_change_proposal"          JSONB,
  "buyer_decision"                    TEXT,
  "decided_at"                        TIMESTAMP(3),
  "reminded_12h_at"                   TIMESTAMP(3),
  "due_at"                            TIMESTAMP(3),
  "created_at"                        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- §11 recap. `preliminary_allowance_cents` here is the dealership's figure at recap, distinct from
-- the verified allowance recorded at handover.
CREATE TABLE IF NOT EXISTS "deal_recaps" (
  "id"                           TEXT PRIMARY KEY,
  "deal_id"                      TEXT NOT NULL,
  "version"                      INTEGER NOT NULL DEFAULT 1,
  "itemized"                     JSONB,
  "optional_products"            JSONB,
  "preliminary_allowance_cents"  INTEGER,
  "payoff_good_through_date"     TIMESTAMP(3),
  "equity_cents"                 INTEGER,
  "down_payment_cents"           INTEGER,
  "financing_path"               TEXT,
  "amount_financed_cents"        INTEGER,
  "estimated_payment_cents"      INTEGER,
  "delivery"                     JSONB,
  "plan"                         "BuyerPlan",
  "buyer_confirmed_at"           TIMESTAMP(3),
  "dealer_confirmed_at"          TIMESTAMP(3),
  "superseded_by"                TEXT,
  "dispute_reason"               TEXT,
  "created_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- §26 exception queue. Uses the existing QueueItemType/QueueItemStatus enums (extended in directory 1).
CREATE TABLE IF NOT EXISTS "queue_items" (
  "id"                    TEXT PRIMARY KEY,
  "type"                  "QueueItemType" NOT NULL,
  "status"                "QueueItemStatus" NOT NULL DEFAULT 'OPEN',
  "exception_code"        TEXT,
  "owner_role"            TEXT,
  "assigned_admin_id"     TEXT,
  "vehicle_request_id"    TEXT,
  "deal_id"               TEXT,
  "auction_id"            TEXT,
  "deposit_id"            TEXT,
  "buyer_id"              TEXT,
  "dealer_id"             TEXT,
  "buyer_visible_status"  TEXT,
  "required_action"       TEXT,
  "deadline_at"           TIMESTAMP(3),
  "return_point"          TEXT,
  "resolution"            TEXT,
  "resolved_at"           TIMESTAMP(3),
  "resolved_by"           TEXT,
  "escalated_at"          TIMESTAMP(3),
  "idempotency_key"       TEXT,
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- §21 post-completion obligations.
CREATE TABLE IF NOT EXISTS "post_completion_obligations" (
  "id"                     TEXT PRIMARY KEY,
  "deal_id"                TEXT NOT NULL,
  "type"                   TEXT NOT NULL,
  "status"                 "PostCompletionObligationStatus" NOT NULL DEFAULT 'PENDING',
  "owner_role"             TEXT,
  "due_at"                 TIMESTAMP(3),
  "expected_date"          TIMESTAMP(3),
  "temp_tag_expires_at"    TIMESTAMP(3),
  "evidence"               JSONB,
  "resolved_at"            TIMESTAMP(3),
  "notes"                  TEXT,
  "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- §20 corrections — append-only; nothing in this table is ever updated in place (§11.7).
CREATE TABLE IF NOT EXISTS "deal_corrections" (
  "id"          TEXT PRIMARY KEY,
  "deal_id"     TEXT NOT NULL,
  "kind"        TEXT NOT NULL,
  "before"      JSONB,
  "after"       JSONB,
  "reason"      TEXT,
  "actor"       TEXT,
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- OWNER-GATED (§13-D8 — created only if the MarketCheck terms permit caching). Omittable as a unit;
-- without it the qualified-results path runs uncached.
CREATE TABLE IF NOT EXISTS "inventory_query_cache" (
  "id"              TEXT PRIMARY KEY,
  "criteria_hash"   TEXT NOT NULL,
  "buyer_id"        TEXT,
  "params"          JSONB NOT NULL,
  "result"          JSONB NOT NULL,
  "num_found"       INTEGER NOT NULL DEFAULT 0,
  "fetched_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"      TIMESTAMP(3)
);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 5. ADOPTING THE RAW-SQL BACKGROUND TABLES INTO THE CHAIN  (§5.2, §13-D24)
--
-- These four already exist in production with live rows, provisioned outside Prisma. Written here to
-- match the definitions probed read-only from production on 2026-09-03, so CREATE TABLE IF NOT EXISTS
-- creates nothing there and everything on a from-zero replay. rollback.sql must never DROP them.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS "comms_outbox" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "channel"       TEXT NOT NULL,
  "dedup_key"     TEXT NOT NULL,
  "status"        TEXT NOT NULL DEFAULT 'pending'
                  CHECK ("status" IN ('pending','sending','sent','failed','suppressed','skipped')),
  "payload"       JSONB NOT NULL,
  "attempts"      INTEGER NOT NULL DEFAULT 0,
  "last_error"    TEXT,
  "last_result"   TEXT,
  "provider_id"   TEXT,
  "run_at"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "claimed_at"    TIMESTAMPTZ,
  "dispatched_at" TIMESTAMPTZ,
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_comms_outbox_dedup_key" ON "comms_outbox" ("dedup_key");
CREATE INDEX IF NOT EXISTS "idx_comms_outbox_drain" ON "comms_outbox" ("run_at")
  WHERE "status" IN ('pending','sending');

-- §27: in-app notices ride the same rail, so the channel CHECK widens. Idempotent drop-then-add.
ALTER TABLE "comms_outbox" DROP CONSTRAINT IF EXISTS "comms_outbox_channel_check";
ALTER TABLE "comms_outbox" ADD CONSTRAINT "comms_outbox_channel_check"
  CHECK ("channel" IN ('email','sms','in_app'));

ALTER TABLE "comms_outbox"
  ADD COLUMN IF NOT EXISTS "trigger_event"      TEXT,
  ADD COLUMN IF NOT EXISTS "template_key"       TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_kind"     TEXT,
  ADD COLUMN IF NOT EXISTS "recipient_id"       TEXT,
  ADD COLUMN IF NOT EXISTS "vehicle_request_id" TEXT,
  ADD COLUMN IF NOT EXISTS "deal_id"            TEXT,
  ADD COLUMN IF NOT EXISTS "auction_id"         TEXT,
  ADD COLUMN IF NOT EXISTS "cancel_key"         TEXT,
  ADD COLUMN IF NOT EXISTS "cancelled_at"       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "cancel_reason"      TEXT,
  ADD COLUMN IF NOT EXISTS "next_attempt_at"    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "max_attempts"       INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "terminal_failed_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "state_recheck"      JSONB;

CREATE TABLE IF NOT EXISTS "lifecycle_touch_schedule" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "base_key"    TEXT NOT NULL,
  "sequence"    TEXT NOT NULL,
  "entity_id"   TEXT NOT NULL,
  "first_name"  TEXT,
  "email"       TEXT NOT NULL,
  "phone"       TEXT,
  "run_at"      TIMESTAMPTZ NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'pending'
                CHECK ("status" IN ('pending','sending','done','canceled','failed')),
  "attempts"    INTEGER NOT NULL DEFAULT 0,
  "last_error"  TEXT,
  "claimed_at"  TIMESTAMPTZ,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_lifecycle_touch_key_sequence"
  ON "lifecycle_touch_schedule" ("base_key", "sequence");
CREATE INDEX IF NOT EXISTS "idx_lifecycle_touch_due" ON "lifecycle_touch_schedule" ("run_at")
  WHERE "status" IN ('pending','sending');

-- Production already admits 19 sequences (the repo's manual SQL, which admits 17, is the stale side —
-- §5.2, §13-D24). Written to production's list, so no constraint swap runs there.
ALTER TABLE "lifecycle_touch_schedule" DROP CONSTRAINT IF EXISTS "lifecycle_touch_schedule_sequence_check";
ALTER TABLE "lifecycle_touch_schedule" DROP CONSTRAINT IF EXISTS "lifecycle_touch_sequence_allowed";
ALTER TABLE "lifecycle_touch_schedule" ADD CONSTRAINT "lifecycle_touch_sequence_allowed" CHECK ("sequence" IN (
  'deposit_reminder_1','deposit_reminder_2','deposit_reminder_3','deposit_reminder_4',
  'deposit_reminder_5','deposit_reminder_6',
  'auction_active','auction_midpoint','auction_closing',
  'dealer_invited',
  'offer_received','offer_follow_up_1','offer_follow_up_2',
  'deal_complete','review_request',
  'form_submitted','check_form_completion_1','check_form_completion_2','check_form_completion_3'
));

CREATE TABLE IF NOT EXISTS "idempotency_keys" (
  "key_hash"          TEXT PRIMARY KEY,
  "execution_status"  TEXT NOT NULL
                      CHECK ("execution_status" IN ('processing','completed','failed')),
  "response_payload"  JSONB DEFAULT '{}',
  "created_at"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_idempotency_created" ON "idempotency_keys" ("created_at");

CREATE TABLE IF NOT EXISTS "jobs_dead_letter" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "job_id"            TEXT NOT NULL,
  "event_name"        TEXT NOT NULL,
  "payload"           JSONB NOT NULL DEFAULT '{}',
  "error_message"     TEXT NOT NULL,
  "failed_at"         TIMESTAMPTZ NOT NULL DEFAULT now(),
  "auto_retry_count"  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS "idx_dlq_event" ON "jobs_dead_letter" ("event_name");
CREATE INDEX IF NOT EXISTS "idx_dlq_failed_at" ON "jobs_dead_letter" ("failed_at" DESC);

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 6. FOREIGN KEYS
--
-- ADD CONSTRAINT has no IF NOT EXISTS, so each key is added only when pg_constraint lacks its name.
-- Every key is nullable and ON DELETE SET NULL unless the child cannot exist without its parent, in
-- which case CASCADE. Master rule 10: the physical key lives on the child.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  fk RECORD;
BEGIN
  FOR fk IN
    SELECT * FROM (VALUES
      -- vehicle_requests
      ('vehicle_requests_inventory_item_id_fkey',    'vehicle_requests',      'inventory_item_id',    'inventory_items',   'SET NULL'),
      ('vehicle_requests_pre_qualification_id_fkey', 'vehicle_requests',      'pre_qualification_id', 'pre_qualifications','SET NULL'),
      ('vehicle_requests_plan_snapshot_id_fkey',     'vehicle_requests',      'plan_snapshot_id',     'plan_snapshots',    'SET NULL'),
      ('vehicle_requests_affiliate_id_fkey',         'vehicle_requests',      'affiliate_id',         'affiliates',        'SET NULL'),
      -- assigned_admin_id already exists as a bare text column with no key at all (R2).
      ('vehicle_requests_assigned_admin_id_fkey',    'vehicle_requests',      'assigned_admin_id',    'users',             'SET NULL'),
      -- deposits / auctions
      ('deposits_vehicle_request_id_fkey',           'deposits',              'vehicle_request_id',   'vehicle_requests',  'SET NULL'),
      ('auctions_sourcing_case_id_fkey',             'auctions',              'sourcing_case_id',     'sourcing_cases',    'SET NULL'),
      -- co-buyers (child owns the key)
      ('co_buyers_buyer_id_fkey',                    'co_buyers',             'buyer_id',             'buyers',            'CASCADE'),
      ('co_buyers_vehicle_request_id_fkey',          'co_buyers',             'vehicle_request_id',   'vehicle_requests',  'SET NULL'),
      -- plan snapshots (lineage side)
      ('plan_snapshots_buyer_id_fkey',               'plan_snapshots',        'buyer_id',             'buyers',            'CASCADE'),
      ('plan_snapshots_vehicle_request_id_fkey',     'plan_snapshots',        'vehicle_request_id',   'vehicle_requests',  'SET NULL'),
      ('plan_snapshots_deal_id_fkey',                'plan_snapshots',        'deal_id',              'deals',             'SET NULL'),
      -- deals
      ('deals_vehicle_request_id_fkey',              'deals',                 'vehicle_request_id',   'vehicle_requests',  'SET NULL'),
      ('deals_auction_id_fkey',                      'deals',                 'auction_id',           'auctions',          'SET NULL'),
      ('deals_deposit_id_fkey',                      'deals',                 'deposit_id',           'deposits',          'SET NULL'),
      ('deals_dealer_id_fkey',                       'deals',                 'dealer_id',            'dealers',           'SET NULL'),
      ('deals_rooftop_id_fkey',                      'deals',                 'rooftop_id',           'dealer_rooftops',   'SET NULL'),
      ('deals_co_buyer_id_fkey',                     'deals',                 'co_buyer_id',          'co_buyers',         'SET NULL'),
      ('deals_plan_snapshot_id_fkey',                'deals',                 'plan_snapshot_id',     'plan_snapshots',    'SET NULL'),
      ('deals_dealer_executed_contract_id_fkey',     'deals',                 'dealer_executed_contract_id', 'contract_versions', 'SET NULL'),
      -- offers / candidates / invitations
      ('offers_auction_vehicle_id_fkey',             'offers',                'auction_vehicle_id',   'auction_vehicles',  'SET NULL'),
      ('offers_rooftop_id_fkey',                     'offers',                'rooftop_id',           'dealer_rooftops',   'SET NULL'),
      ('auction_vehicles_vehicle_request_id_fkey',   'auction_vehicles',      'vehicle_request_id',   'vehicle_requests',  'SET NULL'),
      ('auction_invitations_rooftop_id_fkey',        'auction_invitations',   'rooftop_id',           'dealer_rooftops',   'SET NULL'),
      -- sourcing ladder
      ('sourcing_cases_vehicle_request_id_fkey',     'sourcing_cases',        'vehicle_request_id',   'vehicle_requests',  'CASCADE'),
      ('sourcing_candidates_sourcing_case_id_fkey',  'sourcing_candidates',   'sourcing_case_id',     'sourcing_cases',    'CASCADE'),
      ('sourcing_candidates_rooftop_id_fkey',        'sourcing_candidates',   'rooftop_id',           'dealer_rooftops',   'SET NULL'),
      -- deal-side children
      ('dealer_reaffirmations_deal_id_fkey',         'dealer_reaffirmations', 'deal_id',              'deals',             'CASCADE'),
      ('dealer_reaffirmations_dealer_id_fkey',       'dealer_reaffirmations', 'dealer_id',            'dealers',           'SET NULL'),
      ('deal_recaps_deal_id_fkey',                   'deal_recaps',           'deal_id',              'deals',             'CASCADE'),
      ('deal_corrections_deal_id_fkey',              'deal_corrections',      'deal_id',              'deals',             'CASCADE'),
      ('post_completion_obligations_deal_id_fkey',   'post_completion_obligations', 'deal_id',        'deals',             'CASCADE'),
      -- financing / insurance / contracts / trade
      ('external_pre_approvals_deal_id_fkey',        'external_pre_approvals','deal_id',              'deals',             'SET NULL'),
      ('financing_audit_events_financing_id_fkey',   'financing_audit_events','financing_id',         'financing',         'SET NULL'),
      ('e_sign_envelopes_co_buyer_id_fkey',          'e_sign_envelopes',      'co_buyer_id',          'co_buyers',         'SET NULL'),
      ('trade_in_submissions_vehicle_request_id_fkey','trade_in_submissions', 'vehicle_request_id',   'vehicle_requests',  'SET NULL'),
      ('trade_in_submissions_deal_id_fkey',          'trade_in_submissions',  'deal_id',              'deals',             'SET NULL'),
      -- queue (§8.2: a guarded FK with a relation, never a bare id column)
      ('queue_items_assigned_admin_id_fkey',         'queue_items',           'assigned_admin_id',    'users',             'SET NULL'),
      ('queue_items_vehicle_request_id_fkey',        'queue_items',           'vehicle_request_id',   'vehicle_requests',  'SET NULL'),
      ('queue_items_deal_id_fkey',                   'queue_items',           'deal_id',              'deals',             'SET NULL'),
      ('queue_items_auction_id_fkey',                'queue_items',           'auction_id',           'auctions',          'SET NULL'),
      ('queue_items_deposit_id_fkey',                'queue_items',           'deposit_id',           'deposits',          'SET NULL'),
      ('queue_items_buyer_id_fkey',                  'queue_items',           'buyer_id',             'buyers',            'SET NULL'),
      ('queue_items_dealer_id_fkey',                 'queue_items',           'dealer_id',            'dealers',           'SET NULL'),
      -- misc
      ('circumvention_attempts_dealer_id_fkey',      'circumvention_attempts','dealer_id',            'dealers',           'SET NULL'),
      ('buyer_opportunities_affiliate_id_fkey',      'buyer_opportunities',   'affiliate_id',         'affiliates',        'SET NULL'),
      ('inventory_query_cache_buyer_id_fkey',        'inventory_query_cache', 'buyer_id',             'buyers',            'SET NULL')
    ) AS t(conname, child, col, parent, on_delete)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = fk.conname) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I("id") ON DELETE %s ON UPDATE CASCADE',
        fk.child, fk.conname, fk.col, fk.parent, fk.on_delete);
    END IF;
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 7. INDEXES AND UNIQUENESS
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS "vehicle_requests_inventory_item_id_idx"    ON "vehicle_requests" ("inventory_item_id");
CREATE INDEX IF NOT EXISTS "vehicle_requests_pre_qualification_id_idx" ON "vehicle_requests" ("pre_qualification_id");
CREATE INDEX IF NOT EXISTS "vehicle_requests_plan_snapshot_id_idx"     ON "vehicle_requests" ("plan_snapshot_id");
CREATE INDEX IF NOT EXISTS "vehicle_requests_affiliate_id_idx"         ON "vehicle_requests" ("affiliate_id");
CREATE INDEX IF NOT EXISTS "vehicle_requests_assigned_admin_id_idx"    ON "vehicle_requests" ("assigned_admin_id");
CREATE INDEX IF NOT EXISTS "deposits_vehicle_request_id_idx"           ON "deposits" ("vehicle_request_id");
CREATE INDEX IF NOT EXISTS "deals_vehicle_request_id_idx"              ON "deals" ("vehicle_request_id");
CREATE INDEX IF NOT EXISTS "deals_auction_id_idx"                      ON "deals" ("auction_id");
CREATE INDEX IF NOT EXISTS "deals_dealer_id_idx"                       ON "deals" ("dealer_id");
CREATE INDEX IF NOT EXISTS "deals_plan_snapshot_id_idx"                ON "deals" ("plan_snapshot_id");
CREATE INDEX IF NOT EXISTS "offers_auction_vehicle_id_idx"             ON "offers" ("auction_vehicle_id");
CREATE INDEX IF NOT EXISTS "auction_vehicles_vehicle_request_id_idx"   ON "auction_vehicles" ("vehicle_request_id");
CREATE INDEX IF NOT EXISTS "co_buyers_buyer_id_idx"                    ON "co_buyers" ("buyer_id");
CREATE INDEX IF NOT EXISTS "plan_snapshots_buyer_id_idx"               ON "plan_snapshots" ("buyer_id");
CREATE INDEX IF NOT EXISTS "plan_snapshots_deal_id_idx"                ON "plan_snapshots" ("deal_id");
CREATE INDEX IF NOT EXISTS "dealer_reaffirmations_deal_id_idx"         ON "dealer_reaffirmations" ("deal_id");
CREATE INDEX IF NOT EXISTS "deal_recaps_deal_id_idx"                   ON "deal_recaps" ("deal_id");
CREATE INDEX IF NOT EXISTS "deal_corrections_deal_id_idx"              ON "deal_corrections" ("deal_id");
CREATE INDEX IF NOT EXISTS "post_completion_obligations_deal_id_idx"   ON "post_completion_obligations" ("deal_id");
CREATE INDEX IF NOT EXISTS "sourcing_candidates_case_idx"              ON "sourcing_candidates" ("sourcing_case_id");
-- The §26 row identifier is the queue's lookup key.
CREATE INDEX IF NOT EXISTS "queue_items_exception_code_idx"            ON "queue_items" ("exception_code");
CREATE INDEX IF NOT EXISTS "queue_items_status_idx"                    ON "queue_items" ("status");

-- Master rule 10: one sourcing case per request; one co-buyer per request.
CREATE UNIQUE INDEX IF NOT EXISTS "sourcing_cases_vehicle_request_id_key"
  ON "sourcing_cases" ("vehicle_request_id");
CREATE UNIQUE INDEX IF NOT EXISTS "co_buyers_vehicle_request_id_key"
  ON "co_buyers" ("vehicle_request_id") WHERE "vehicle_request_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "queue_items_idempotency_key_key"
  ON "queue_items" ("idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "auction_invitations_token_hash_key"
  ON "auction_invitations" ("token_hash") WHERE "token_hash" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "auction_invitations_auction_rooftop_key"
  ON "auction_invitations" ("auction_id", "rooftop_id") WHERE "rooftop_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "dealer_rooftops_mc_rooftop_id_key"
  ON "dealer_rooftops" ("mc_rooftop_id") WHERE "mc_rooftop_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_query_cache_criteria_hash_key"
  ON "inventory_query_cache" ("criteria_hash");
-- One live offer per rooftop per candidate (§22a).
CREATE UNIQUE INDEX IF NOT EXISTS "offers_one_live_per_rooftop_candidate_key"
  ON "offers" ("auction_id", "rooftop_id", "auction_vehicle_id") WHERE "status" = 'SUBMITTED';

-- The e-sign constraint SWAP (§13-D30): the co-buyer needs a second envelope per deal, so the unique
-- deal_id becomes unique per (deal_id, signer_kind). This is the one non-additive statement in the
-- wave; rollback.sql carries its explicit restore, because a guarded "drop what we created" cannot
-- recreate a constraint the wave replaced.
ALTER TABLE "e_sign_envelopes" DROP CONSTRAINT IF EXISTS "e_sign_envelopes_deal_id_key";
DROP INDEX IF EXISTS "e_sign_envelopes_deal_id_key";
CREATE UNIQUE INDEX IF NOT EXISTS "e_sign_envelopes_deal_id_signer_kind_key"
  ON "e_sign_envelopes" ("deal_id", "signer_kind");

-- Legacy-path counter (master rule 7). Names the label directory 1 committed to AdminActionType.
CREATE INDEX IF NOT EXISTS "audit_logs_legacy_path_write_idx"
  ON "audit_logs" ("action", "created_at") WHERE "action" = 'LEGACY_PATH_WRITE';

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 8. ENFORCEMENT OBJECT 1 — one open Vehicle Request per buyer
--
-- The predicate hard-codes the answer to §13-D5: a request is "open" while it is still the live
-- fulfilment object. DEAL_CREATED is excluded because the Deal is then the live object and §23.4 must
-- keep "a second Vehicle Request means a new $99" possible; the three terminals are excluded too.
--
-- PRODUCTION PRECONDITION: §5.6 found three buyers holding 2–5 rows in this set. The index cannot be
-- created in production until §13-D2's owner-run, audited cleanup completes. This proof runs against
-- an empty isolated database, so it proves the statement is valid — not that production is ready.
-- Never CONCURRENTLY: Prisma runs this file in one transaction.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_requests_one_open_per_buyer_key"
  ON "vehicle_requests" ("buyer_id")
  WHERE "status" IN (
    'DRAFT','SUBMITTED','INTAKE','PAYMENT_REQUIRED','ACTIVE_SOURCING','RADIUS_AUTHORIZATION_REQUIRED',
    'OFFER_READY','OFFER_SENT','OFFER_ACCEPTED','OFFER_DECLINED');

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 9. ENFORCEMENT OBJECT 2 — the five-candidate cap, enforced by the database
--
-- Counting in application code loses the race. Each trigger locks the parent row FOR UPDATE, so two
-- concurrent inserts serialise and the sixth raises P0001 rather than being written.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION "shortlist_items_enforce_cap"() RETURNS trigger AS $fn$
DECLARE
  existing INTEGER;
BEGIN
  PERFORM 1 FROM "shortlists" WHERE "id" = NEW."shortlist_id" FOR UPDATE;
  SELECT count(*) INTO existing FROM "shortlist_items" WHERE "shortlist_id" = NEW."shortlist_id";
  IF existing >= 5 THEN
    RAISE EXCEPTION 'shortlist % already holds the maximum of 5 candidates', NEW."shortlist_id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "shortlist_items_enforce_cap_trg" ON "shortlist_items";
CREATE TRIGGER "shortlist_items_enforce_cap_trg"
  BEFORE INSERT ON "shortlist_items"
  FOR EACH ROW EXECUTE FUNCTION "shortlist_items_enforce_cap"();

CREATE OR REPLACE FUNCTION "auction_vehicles_enforce_cap"() RETURNS trigger AS $fn$
DECLARE
  existing INTEGER;
BEGIN
  IF NEW."vehicle_request_id" IS NULL THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM "vehicle_requests" WHERE "id" = NEW."vehicle_request_id" FOR UPDATE;
  SELECT count(*) INTO existing
    FROM "auction_vehicles"
   WHERE "vehicle_request_id" = NEW."vehicle_request_id"
     AND "candidate_status" <> 'DROPPED';
  IF existing >= 5 THEN
    RAISE EXCEPTION 'vehicle request % already holds the maximum of 5 candidates', NEW."vehicle_request_id"
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "auction_vehicles_enforce_cap_trg" ON "auction_vehicles";
CREATE TRIGGER "auction_vehicles_enforce_cap_trg"
  BEFORE INSERT ON "auction_vehicles"
  FOR EACH ROW EXECUTE FUNCTION "auction_vehicles_enforce_cap"();

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 10. ROW-LEVEL SECURITY
--
-- §5.4: every transaction table in production has RLS enabled and ZERO policies, and the application
-- connects as the table owner, which bypasses RLS. Adding a policy would OPEN client access, not
-- harden it. New tables therefore ship enabled with no policies, matching the established pattern.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'co_buyers','plan_snapshots','sourcing_cases','sourcing_candidates','dealer_reaffirmations',
    'deal_recaps','queue_items','post_completion_obligations','deal_corrections',
    'inventory_query_cache','comms_outbox','lifecycle_touch_schedule','idempotency_keys',
    'jobs_dead_letter'
  ] LOOP
    IF to_regclass(format('public.%I', t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
