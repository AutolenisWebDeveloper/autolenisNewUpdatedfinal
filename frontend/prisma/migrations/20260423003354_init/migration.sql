-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('BUYER', 'DEALER', 'AFFILIATE', 'SUPER_ADMIN', 'OPERATIONS_ADMIN', 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'OPERATIONS_ADMIN', 'COMPLIANCE_ADMIN', 'FINANCE_ADMIN', 'SUPPORT_ADMIN');

-- CreateEnum
CREATE TYPE "DealerStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AffiliateStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "InsuranceStatus" AS ENUM ('NOT_STARTED', 'QUOTE_REQUESTED', 'QUOTE_RECEIVED', 'POLICY_SELECTED', 'POLICY_BOUND', 'EXTERNAL_UPLOADED', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('PENDING', 'ACTIVE', 'CLOSED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('PENDING', 'ACTIVE', 'FINANCING_PENDING', 'FEE_PENDING', 'FEE_PAID', 'INSURANCE_PENDING', 'CONTRACT_PENDING', 'CONTRACT_REVIEW', 'CONTRACT_APPROVED', 'SIGNING_PENDING', 'SIGNED', 'PICKUP_SCHEDULED', 'PICKUP_COMPLETE', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'REVERSED');

-- CreateEnum
CREATE TYPE "PreQualDecision" AS ENUM ('APPROVED', 'DECLINED', 'PENDING', 'MANUAL_REVIEW', 'OFAC_ESCALATED');

-- CreateEnum
CREATE TYPE "PreQualTier" AS ENUM ('STRONG', 'GOOD', 'FAIR', 'WEAK', 'DECLINED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED');

-- CreateEnum
CREATE TYPE "ESignStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'COMPLETED', 'DECLINED', 'VOIDED');

-- CreateEnum
CREATE TYPE "PickupStatus" AS ENUM ('NOT_SCHEDULED', 'SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'RESCHEDULED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('AUCTION_STARTED', 'AUCTION_CLOSING_SOON', 'OFFER_RECEIVED', 'DEAL_SELECTED', 'DEAL_STAGE_CHANGED', 'CONTRACT_READY', 'CONTRACT_APPROVED', 'SIGNING_READY', 'PICKUP_SCHEDULED', 'PICKUP_READY', 'PREQUAL_APPROVED', 'PREQUAL_DECLINED', 'DEPOSIT_CONFIRMED', 'FEE_PAID', 'INSURANCE_BOUND', 'COMMISSION_EARNED', 'COMMISSION_PAID', 'REFERRAL_SIGNED_UP', 'REFERRAL_DEAL_COMPLETED', 'SYSTEM_ALERT', 'ADMIN_MESSAGE', 'REQUEST_STATUS_UPDATE', 'OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_DECLINED');

-- CreateEnum
CREATE TYPE "RiskTier" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NudgeChannel" AS ENUM ('IN_APP', 'EMAIL');

-- CreateEnum
CREATE TYPE "InventoryLane" AS ENUM ('LANE_1', 'LANE_2', 'LANE_3');

-- CreateEnum
CREATE TYPE "VehicleRequestStatus" AS ENUM ('SUBMITTED', 'INTAKE', 'ACTIVE_SOURCING', 'OFFER_READY', 'OFFER_SENT', 'OFFER_ACCEPTED', 'OFFER_DECLINED', 'DEAL_CREATED', 'CLOSED_NO_MATCH', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "supabase_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "terms_accepted_at" TIMESTAMP(3),
    "terms_version" TEXT,
    "profile_picture_url" TEXT,
    "employment_status" TEXT,
    "income_range" TEXT,
    "affiliate_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "dealership_name" TEXT NOT NULL,
    "phone" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "status" "DealerStatus" NOT NULL DEFAULT 'PENDING',
    "tier" TEXT NOT NULL DEFAULT 'STANDARD',
    "current_auction_load" INTEGER NOT NULL DEFAULT 0,
    "scorecard_tier" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliates" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "status" "AffiliateStatus" NOT NULL DEFAULT 'PENDING',
    "parent_id" TEXT,
    "level" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "totp_secret" TEXT,
    "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
    "recovery_codes" TEXT[],
    "mfa_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_qualifications" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "decision" "PreQualDecision" NOT NULL,
    "tier" "PreQualTier",
    "expires_at" TIMESTAMP(3) NOT NULL,
    "max_otd_amount_cents" INTEGER NOT NULL,
    "check_ofac_alert" BOOLEAN NOT NULL DEFAULT false,
    "raw_response" TEXT,
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pre_qualifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlists" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shortlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlist_items" (
    "id" TEXT NOT NULL,
    "shortlist_id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readiness_state" TEXT NOT NULL DEFAULT 'AUCTION_READY',

    CONSTRAINT "shortlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'PENDING',
    "stripe_payment_intent_id" TEXT,
    "stripe_session_id" TEXT,
    "refunded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auctions" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "deposit_id" TEXT NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "closed_at" TIMESTAMP(3),
    "extended_at" TIMESTAMP(3),
    "extended_by" TEXT,
    "extend_reason" TEXT,
    "original_auction_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_invitations" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "invitation_score" DOUBLE PRECISION,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewed_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "auction_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "otd_price_cents" INTEGER NOT NULL,
    "vehicle_price_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "fees_cents" INTEGER NOT NULL DEFAULT 0,
    "junk_fee_items" JSONB NOT NULL DEFAULT '[]',
    "includes_financing" BOOLEAN NOT NULL DEFAULT false,
    "apr_rate" DOUBLE PRECISION,
    "term_months" INTEGER,
    "best_price_score" DOUBLE PRECISION,
    "rank_cash" INTEGER,
    "rank_monthly" INTEGER,
    "rank_balanced" INTEGER,
    "apr_flag" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "original_offer_id" TEXT,
    "submitted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'PENDING',
    "financing_path" TEXT,
    "insurance_status" "InsuranceStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "fee_paid_at" TIMESTAMP(3),
    "fee_amount_cents" INTEGER,
    "stripe_fee_pi_id" TEXT,
    "contract_shield_score" INTEGER,
    "contract_shield_status" TEXT,
    "risk_score" INTEGER,
    "risk_tier" "RiskTier",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_scans" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "fix_list" JSONB NOT NULL DEFAULT '[]',
    "change_log" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_scans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_scan_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "rule_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contract_scan_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "violation_pattern_records" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "violation_pattern_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "e_sign_envelopes" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "docusign_envelope_id" TEXT,
    "status" "ESignStatus" NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "e_sign_envelopes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickups" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "status" "PickupStatus" NOT NULL DEFAULT 'NOT_SCHEDULED',
    "scheduled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "location" TEXT,
    "qr_code_data" TEXT,
    "qr_code_image" TEXT,
    "qr_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pickups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_provider_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commissions" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "qualifying_event_id" TEXT NOT NULL,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT,
    "dealer_id" TEXT,
    "affiliate_id" TEXT,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'IN_APP',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "action_url" TEXT,
    "read_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nudge_events" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "channel" "NudgeChannel" NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissed_at" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "nudge_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT,
    "lane" "InventoryLane" NOT NULL DEFAULT 'LANE_3',
    "vin" TEXT,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT,
    "mileage" INTEGER,
    "price_cents" INTEGER NOT NULL,
    "description" TEXT,
    "price_history" JSONB NOT NULL DEFAULT '[]',
    "external_listing_url" TEXT,
    "external_dealer_name" TEXT,
    "external_dealer_phone" TEXT,
    "external_dealer_city" TEXT,
    "external_dealer_state" TEXT,
    "images" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_requests" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "status" "VehicleRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "make_preference" TEXT,
    "model_preference" TEXT,
    "year_min" INTEGER,
    "year_max" INTEGER,
    "max_budget_cents" INTEGER,
    "notes" TEXT,
    "assigned_admin_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_request_research_logs" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "source_url" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_request_research_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_request_due_diligence_checkpoints" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "completed_by" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_request_due_diligence_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_request_offers" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "vehicle_info" JSONB NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "notes" TEXT,
    "sent_at" TIMESTAMP(3),
    "responded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_request_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_request_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "payload" JSONB,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_request_buyer_updates" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_request_buyer_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verse_library" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "book" TEXT NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "translation" TEXT NOT NULL DEFAULT 'NKJV',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verse_library_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verse_page_assignments" (
    "id" TEXT NOT NULL,
    "page_key" TEXT NOT NULL,
    "verse_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_override" BOOLEAN NOT NULL DEFAULT false,
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "rotation_week" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verse_page_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "encouragement_messages" (
    "id" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "encouragement_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hope_page_content" (
    "id" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hope_page_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_scorecard_snapshots" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "offer_win_rate" DOUBLE PRECISION NOT NULL,
    "deal_completion_rate" DOUBLE PRECISION NOT NULL,
    "auction_response_rate" DOUBLE PRECISION NOT NULL,
    "avg_response_hours" DOUBLE PRECISION NOT NULL,
    "junk_fee_ratio" DOUBLE PRECISION NOT NULL,
    "snapshot_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealer_scorecard_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_stat_snapshots" (
    "id" TEXT NOT NULL,
    "dealers_count" INTEGER NOT NULL,
    "buyers_served" INTEGER NOT NULL,
    "avg_savings" INTEGER NOT NULL,
    "deals_completed" INTEGER NOT NULL,
    "avg_auction_bids" DOUBLE PRECISION NOT NULL,
    "snapshot_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_stat_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "last_match_at" TIMESTAMP(3),
    "match_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "testimonials" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "testimonials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_milestones" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "milestone" TEXT NOT NULL,
    "reward_type" TEXT NOT NULL,
    "reward_value" INTEGER NOT NULL,
    "achieved" BOOLEAN NOT NULL DEFAULT false,
    "achieved_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_activity_events" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_send_logs" (
    "id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "resend_id" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "best_price_weight_configs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "weight_otd" DOUBLE PRECISION NOT NULL DEFAULT 0.4,
    "weight_monthly" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "weight_fees" DOUBLE PRECISION NOT NULL DEFAULT 0.2,
    "weight_junk_fees" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "best_price_weight_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversation_contexts" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "last_summary" TEXT,
    "concerns" JSONB NOT NULL DEFAULT '[]',
    "preferences" JSONB NOT NULL DEFAULT '{}',
    "last_session_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_conversation_contexts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_briefings" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_supabase_id_key" ON "users"("supabase_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "buyers_user_id_key" ON "buyers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dealers_user_id_key" ON "dealers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_user_id_key" ON "affiliates"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_referral_code_key" ON "affiliates"("referral_code");

-- CreateIndex
CREATE UNIQUE INDEX "admins_user_id_key" ON "admins"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "pre_qualifications_buyer_id_key" ON "pre_qualifications"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "shortlists_buyer_id_key" ON "shortlists"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "shortlist_items_shortlist_id_inventory_item_id_key" ON "shortlist_items"("shortlist_id", "inventory_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_stripe_payment_intent_id_key" ON "deposits"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_stripe_session_id_key" ON "deposits"("stripe_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "auctions_deposit_id_key" ON "auctions"("deposit_id");

-- CreateIndex
CREATE UNIQUE INDEX "auction_invitations_auction_id_dealer_id_key" ON "auction_invitations"("auction_id", "dealer_id");

-- CreateIndex
CREATE UNIQUE INDEX "offers_original_offer_id_key" ON "offers"("original_offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_offer_id_key" ON "deals"("offer_id");

-- CreateIndex
CREATE UNIQUE INDEX "violation_pattern_records_dealer_id_rule_id_key" ON "violation_pattern_records"("dealer_id", "rule_id");

-- CreateIndex
CREATE UNIQUE INDEX "e_sign_envelopes_deal_id_key" ON "e_sign_envelopes"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "e_sign_envelopes_docusign_envelope_id_key" ON "e_sign_envelopes"("docusign_envelope_id");

-- CreateIndex
CREATE UNIQUE INDEX "pickups_deal_id_key" ON "pickups"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_event_id_key" ON "payment_provider_events"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "commissions_qualifying_event_id_key" ON "commissions"("qualifying_event_id");

-- CreateIndex
CREATE INDEX "notifications_buyer_id_read_at_idx" ON "notifications"("buyer_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_dealer_id_read_at_idx" ON "notifications"("dealer_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_affiliate_id_read_at_idx" ON "notifications"("affiliate_id", "read_at");

-- CreateIndex
CREATE INDEX "nudge_events_buyer_id_stage_idx" ON "nudge_events"("buyer_id", "stage");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_vin_key" ON "inventory_items"("vin");

-- CreateIndex
CREATE INDEX "inventory_items_lane_is_active_idx" ON "inventory_items"("lane", "is_active");

-- CreateIndex
CREATE INDEX "vehicle_requests_buyer_id_status_idx" ON "vehicle_requests"("buyer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "verse_library_reference_key" ON "verse_library"("reference");

-- CreateIndex
CREATE INDEX "verse_page_assignments_page_key_is_active_idx" ON "verse_page_assignments"("page_key", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "verse_page_assignments_page_key_effective_at_key" ON "verse_page_assignments"("page_key", "effective_at");

-- CreateIndex
CREATE UNIQUE INDEX "hope_page_content_section_key" ON "hope_page_content"("section");

-- CreateIndex
CREATE INDEX "dealer_scorecard_snapshots_dealer_id_snapshot_date_idx" ON "dealer_scorecard_snapshots"("dealer_id", "snapshot_date");

-- CreateIndex
CREATE INDEX "saved_searches_buyer_id_idx" ON "saved_searches"("buyer_id");

-- CreateIndex
CREATE INDEX "buyer_activity_events_buyer_id_created_at_idx" ON "buyer_activity_events"("buyer_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_send_logs_idempotency_key_key" ON "email_send_logs"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversation_contexts_buyer_id_key" ON "ai_conversation_contexts"("buyer_id");

-- AddForeignKey
ALTER TABLE "buyers" ADD CONSTRAINT "buyers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealers" ADD CONSTRAINT "dealers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliates" ADD CONSTRAINT "affiliates_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_qualifications" ADD CONSTRAINT "pre_qualifications_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlists" ADD CONSTRAINT "shortlists_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shortlist_items" ADD CONSTRAINT "shortlist_items_shortlist_id_fkey" FOREIGN KEY ("shortlist_id") REFERENCES "shortlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_deposit_id_fkey" FOREIGN KEY ("deposit_id") REFERENCES "deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_original_auction_id_fkey" FOREIGN KEY ("original_auction_id") REFERENCES "auctions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auction_invitations" ADD CONSTRAINT "auction_invitations_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_original_offer_id_fkey" FOREIGN KEY ("original_offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_scans" ADD CONSTRAINT "contract_scans_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "e_sign_envelopes" ADD CONSTRAINT "e_sign_envelopes_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickups" ADD CONSTRAINT "pickups_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nudge_events" ADD CONSTRAINT "nudge_events_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_requests" ADD CONSTRAINT "vehicle_requests_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_request_research_logs" ADD CONSTRAINT "vehicle_request_research_logs_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vehicle_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_request_due_diligence_checkpoints" ADD CONSTRAINT "vehicle_request_due_diligence_checkpoints_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vehicle_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_request_offers" ADD CONSTRAINT "vehicle_request_offers_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vehicle_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_request_events" ADD CONSTRAINT "vehicle_request_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vehicle_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_request_buyer_updates" ADD CONSTRAINT "vehicle_request_buyer_updates_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "vehicle_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verse_page_assignments" ADD CONSTRAINT "verse_page_assignments_verse_id_fkey" FOREIGN KEY ("verse_id") REFERENCES "verse_library"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dealer_scorecard_snapshots" ADD CONSTRAINT "dealer_scorecard_snapshots_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_activity_events" ADD CONSTRAINT "buyer_activity_events_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
