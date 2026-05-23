-- CreateEnum
CREATE TYPE "RefinanceStatus" AS ENUM ('SUBMITTED', 'PROCESSING', 'APPROVED', 'DECLINED', 'REDIRECTED');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'UPLOADED', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('SENT', 'DELIVERED', 'READ');

-- CreateEnum
CREATE TYPE "ThreadStatus" AS ENUM ('ACTIVE', 'CLOSED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "InsuranceQuoteStatus" AS ENUM ('PENDING', 'RECEIVED', 'SELECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InsurancePolicyStatus" AS ENUM ('ACTIVE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FinancingStatus" AS ENUM ('PENDING', 'SELECTED', 'APPROVED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ExternalPreApprovalStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'APPROVED', 'REJECTED', 'ADDITIONAL_INFO_REQUIRED');

-- CreateEnum
CREATE TYPE "SeoHealthStatus" AS ENUM ('EXCELLENT', 'GOOD', 'NEEDS_WORK', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SyncRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "InventorySourceType" AS ENUM ('AUTOTRADER', 'CARSDOTCOM', 'CARGURUS', 'TRUECAR', 'EDMUNDS', 'CUSTOM', 'DMS');

-- CreateEnum
CREATE TYPE "DealerDiscoveryStatus" AS ENUM ('DISCOVERED', 'CONTACTED', 'INVITED', 'ONBOARDING', 'ACTIVE', 'DECLINED');

-- CreateEnum
CREATE TYPE "TradeInStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'VALUED', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "TradeInCondition" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR');

-- CreateEnum
CREATE TYPE "NudgeStage" AS ENUM ('PREQUAL_IDLE', 'DEPOSIT_IDLE', 'FINANCING_IDLE', 'INSURANCE_IDLE', 'EMAIL_IDLE');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "SupportNoteType" AS ENUM ('GENERAL', 'ESCALATION', 'IMPERSONATION', 'REFUND', 'COMPLAINT');

-- CreateEnum
CREATE TYPE "ContractVersionStatus" AS ENUM ('UPLOADED', 'SCANNING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AdminActionType" AS ENUM ('STAGE_ADVANCE', 'CANCEL', 'REFUND_TRIGGERED', 'SHIELD_OVERRIDE', 'DEALER_REMOVED', 'AUCTION_CLOSED', 'AUCTION_EXTENDED', 'IMPERSONATION_STARTED', 'STATUS_CHANGE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('SALES_CONTRACT', 'FINANCE_AGREEMENT', 'INSURANCE_PROOF', 'TRADE_IN_TITLE', 'IDENTITY_VERIFICATION', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentRequestStatus" AS ENUM ('PENDING', 'SUBMITTED', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FinancingPath" AS ENUM ('DEALER', 'EXTERNAL', 'CASH');

-- CreateEnum
CREATE TYPE "FinancingScenarioType" AS ENUM ('DEALER_FINANCE', 'EXTERNAL_BANK', 'CASH_PURCHASE');

-- CreateEnum
CREATE TYPE "SeoContentType" AS ENUM ('PAGE', 'BLOG', 'FAQ');

-- CreateEnum
CREATE TYPE "SeoSchemaType" AS ENUM ('ORGANIZATION', 'PRODUCT', 'FAQ_PAGE', 'HOW_TO');

-- CreateEnum
CREATE TYPE "HealthAlertLevel" AS ENUM ('P0', 'P1', 'P2', 'INFO');

-- CreateEnum
CREATE TYPE "SlaStatus" AS ENUM ('OK', 'WARNING', 'BREACHED');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('NUDGE', 'RISK_FLAG', 'DEAL_STUCK', 'AUCTION_EXPIRING', 'INVITATION_LOW');

-- CreateEnum
CREATE TYPE "QueueItemStatus" AS ENUM ('OPEN', 'ASSIGNED', 'RESOLVED', 'ESCALATED', 'CLOSED');

-- CreateEnum
CREATE TYPE "QueueItemType" AS ENUM ('OFAC_ALERT', 'CONTRACT_FAIL', 'INSURANCE_EXCEPTION', 'ESIGN_EXCEPTION', 'PICKUP_EXCEPTION', 'PREQUAL_MANUAL', 'SUPPORT_TICKET', 'SYSTEM_ALERT');

-- CreateEnum
CREATE TYPE "ImpersonationStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "RefundReason" AS ENUM ('NO_OFFERS', 'BUYER_REQUEST', 'FRAUD', 'ADMIN_DECISION');

-- CreateEnum
CREATE TYPE "CancellationReason" AS ENUM ('BUYER_REQUEST', 'FRAUD', 'PREQUAL_EXPIRED', 'NO_OFFERS', 'ADMIN');

-- CreateEnum
CREATE TYPE "EscalationLevel" AS ENUM ('L1', 'L2', 'L3', 'EXECUTIVE');

-- CreateEnum
CREATE TYPE "AffiliateComplianceStatus" AS ENUM ('PENDING_ACKNOWLEDGMENT', 'COMPLIANT', 'VIOLATION_FLAGGED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "AntiCircumventionFlag" AS ENUM ('CONTACT_ATTEMPT', 'EXTERNAL_DEAL', 'IDENTITY_MISMATCH', 'PAYMENT_BYPASS');

-- CreateEnum
CREATE TYPE "IdentityVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "FeedFormat" AS ENUM ('XML', 'JSON', 'CSV');

-- CreateEnum
CREATE TYPE "DealerOnboardingStatus" AS ENUM ('INCOMPLETE', 'COMPLETE', 'VERIFIED');

-- CreateEnum
CREATE TYPE "CronJobStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AffiliateTier" AS ENUM ('STANDARD', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accepted_terms" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "terms_version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address" TEXT,

    CONSTRAINT "accepted_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_pre_approvals" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "status" "ExternalPreApprovalStatus" NOT NULL DEFAULT 'SUBMITTED',
    "lender_name" TEXT,
    "approved_amount_cents" INTEGER,
    "apr_rate" DOUBLE PRECISION,
    "term_months" INTEGER,
    "expiry_date" TIMESTAMP(3),
    "document_url" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by" TEXT,
    "rejection_reason" TEXT,
    "additional_info_required" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_pre_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_in_submissions" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "vin" TEXT,
    "year" INTEGER NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "trim" TEXT,
    "mileage" INTEGER,
    "condition" "TradeInCondition" NOT NULL,
    "loan_status" TEXT,
    "loan_balance_cents" INTEGER,
    "notes" TEXT,
    "status" "TradeInStatus" NOT NULL DEFAULT 'SUBMITTED',
    "valuation_cents" INTEGER,
    "valued_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trade_in_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "path" "FinancingPath" NOT NULL,
    "selected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lender_name" TEXT,
    "approved_amount_cents" INTEGER,
    "apr_rate" DOUBLE PRECISION,
    "term_months" INTEGER,
    "monthly_payment_cents" INTEGER,
    "status" "FinancingStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "financing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financing_scenarios" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "name" TEXT NOT NULL,
    "vehicle_price_cents" INTEGER NOT NULL,
    "down_payment_cents" INTEGER NOT NULL DEFAULT 0,
    "loan_amount_cents" INTEGER NOT NULL,
    "apr_rate" DOUBLE PRECISION NOT NULL,
    "term_months" INTEGER NOT NULL,
    "monthly_payment_cents" INTEGER NOT NULL,
    "total_cost_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financing_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_quotes" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "status" "InsuranceQuoteStatus" NOT NULL DEFAULT 'PENDING',
    "provider_name" TEXT,
    "premium_cents" INTEGER,
    "coverage_type" TEXT,
    "deductible_cents" INTEGER,
    "expires_at" TIMESTAMP(3),
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_policies" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "status" "InsurancePolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "policy_number" TEXT,
    "provider_name" TEXT,
    "proof_url" TEXT,
    "effective_date" TIMESTAMP(3),
    "expiry_date" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT,
    "request_id" TEXT,
    "status" "ThreadStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_message_at" TIMESTAMP(3),
    "flagged_at" TIMESTAMP(3),
    "flag_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_thread_participants" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "last_read_at" TIMESTAMP(3),

    CONSTRAINT "message_thread_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'SENT',
    "is_redacted" BOOLEAN NOT NULL DEFAULT false,
    "redact_reason" TEXT,
    "anti_circumvention_flag" "AntiCircumventionFlag",
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT,
    "dealer_id" TEXT,
    "deal_id" TEXT,
    "type" "DocumentType" NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_requests" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT,
    "buyer_id" TEXT,
    "requested_by" TEXT NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "reason" TEXT,
    "status" "DocumentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "due_at" TIMESTAMP(3),
    "fulfilled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refinance_applications" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "status" "RefinanceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "vehicle_year" INTEGER,
    "vehicle_make" TEXT,
    "vehicle_model" TEXT,
    "current_rate_apr" DOUBLE PRECISION,
    "loan_balance_cents" INTEGER,
    "months_remaining" INTEGER,
    "estimated_credit_score" TEXT,
    "email_address" TEXT,
    "tcpa_consent" BOOLEAN NOT NULL DEFAULT false,
    "partner_id" TEXT,
    "redirected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refinance_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refinance_partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "redirect_url" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refinance_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refinance_compliance_logs" (
    "id" TEXT NOT NULL,
    "application_id" TEXT NOT NULL,
    "tcpa_consent" BOOLEAN NOT NULL,
    "consent_timestamp" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT,
    "source" TEXT,

    CONSTRAINT "refinance_compliance_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_page_configs" (
    "id" TEXT NOT NULL,
    "page_slug" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "canonical_url" TEXT,
    "og_title" TEXT,
    "og_description" TEXT,
    "og_image" TEXT,
    "schema" JSONB,
    "health_score" INTEGER,
    "last_audit_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seo_page_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_keywords" (
    "id" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "search_volume" INTEGER,
    "difficulty" INTEGER,
    "target_pages" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_keywords_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_health_scores" (
    "id" TEXT NOT NULL,
    "page_slug" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "status" "SeoHealthStatus" NOT NULL,
    "audited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_health_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_support_notes" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "type" "SupportNoteType" NOT NULL,
    "content" TEXT NOT NULL,
    "is_internal" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_support_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_impersonations" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ImpersonationStatus" NOT NULL DEFAULT 'ACTIVE',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "admin_impersonations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nudge_configurations" (
    "id" TEXT NOT NULL,
    "stage" "NudgeStage" NOT NULL,
    "in_app_delay_hours" INTEGER NOT NULL DEFAULT 4,
    "email_delay_hours" INTEGER NOT NULL DEFAULT 48,
    "max_dismissals" INTEGER NOT NULL DEFAULT 3,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 48,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "nudge_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_scorecard_weights" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "weight_win_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.35,
    "weight_completion" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "weight_response" DOUBLE PRECISION NOT NULL DEFAULT 0.20,
    "weight_junk_fees" DOUBLE PRECISION NOT NULL DEFAULT 0.20,
    "created_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_scorecard_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_feed_configs" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "feed_url" TEXT NOT NULL,
    "format" "FeedFormat" NOT NULL,
    "refresh_interval_hours" INTEGER NOT NULL DEFAULT 24,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_sync_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_feed_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_coverage" (
    "id" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'ACTIVE',
    "listing_count" INTEGER NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "market_coverage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_discoveries" (
    "id" TEXT NOT NULL,
    "dealer_name" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "discovered_from" TEXT NOT NULL,
    "inventory_count" INTEGER NOT NULL DEFAULT 0,
    "status" "DealerDiscoveryStatus" NOT NULL DEFAULT 'DISCOVERED',
    "contacted_at" TIMESTAMP(3),
    "invited_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_discoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_inventory_search_runs" (
    "id" TEXT NOT NULL,
    "triggered_by" TEXT NOT NULL,
    "params" JSONB NOT NULL,
    "status" "CronJobStatus" NOT NULL DEFAULT 'RUNNING',
    "adapters_run" INTEGER NOT NULL DEFAULT 0,
    "vehicles_fetched" INTEGER NOT NULL DEFAULT 0,
    "vehicles_upserted" INTEGER NOT NULL DEFAULT 0,
    "health_score" INTEGER,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "admin_inventory_search_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_sources" (
    "id" TEXT NOT NULL,
    "type" "InventorySourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "last_run_status" TEXT,
    "vehicles_last_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_sync_runs" (
    "id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "status" "SyncRunStatus" NOT NULL,
    "vehicles_fetched" INTEGER NOT NULL DEFAULT 0,
    "vehicles_upserted" INTEGER NOT NULL DEFAULT 0,
    "vehicles_deactivated" INTEGER NOT NULL DEFAULT 0,
    "health_score" INTEGER,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "inventory_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_payouts" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "method" TEXT,
    "reference" TEXT,
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "failure_reason" TEXT,

    CONSTRAINT "affiliate_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_versions" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploaded_by" TEXT NOT NULL,
    "status" "ContractVersionStatus" NOT NULL DEFAULT 'UPLOADED',
    "scan_run_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "user_id" TEXT,
    "action" "AdminActionType" NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "reason" TEXT,
    "ip_address" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'sessions')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'sessions')) IS NOT NULL THEN
    CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'accepted_terms')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "accepted_terms_user_id_terms_version_key" ON "accepted_terms"("user_id", "terms_version");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'financing')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "financing_deal_id_key" ON "financing"("deal_id");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'message_thread_participants')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "message_thread_participants_thread_id_user_id_key" ON "message_thread_participants"("thread_id", "user_id");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'messages')) IS NOT NULL THEN
    CREATE INDEX "messages_thread_id_idx" ON "messages"("thread_id");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_partners')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "refinance_partners_partner_id_key" ON "refinance_partners"("partner_id");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'seo_page_configs')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "seo_page_configs_page_slug_key" ON "seo_page_configs"("page_slug");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'seo_keywords')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "seo_keywords_keyword_key" ON "seo_keywords"("keyword");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'nudge_configurations')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "nudge_configurations_stage_key" ON "nudge_configurations"("stage");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'dealer_feed_configs')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "dealer_feed_configs_dealer_id_key" ON "dealer_feed_configs"("dealer_id");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'market_coverage')) IS NOT NULL THEN
    CREATE UNIQUE INDEX "market_coverage_city_state_key" ON "market_coverage"("city", "state");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'audit_logs')) IS NOT NULL THEN
    CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
  END IF;
END $$;

-- CreateIndex
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'audit_logs')) IS NOT NULL THEN
    CREATE INDEX "audit_logs_admin_id_idx" ON "audit_logs"("admin_id");
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'sessions')) IS NOT NULL THEN
    ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'accepted_terms')) IS NOT NULL THEN
    ALTER TABLE "accepted_terms" ADD CONSTRAINT "accepted_terms_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'external_pre_approvals')) IS NOT NULL THEN
    ALTER TABLE "external_pre_approvals" ADD CONSTRAINT "external_pre_approvals_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'trade_in_submissions')) IS NOT NULL THEN
    ALTER TABLE "trade_in_submissions" ADD CONSTRAINT "trade_in_submissions_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'financing')) IS NOT NULL THEN
    ALTER TABLE "financing" ADD CONSTRAINT "financing_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'financing_scenarios')) IS NOT NULL THEN
    ALTER TABLE "financing_scenarios" ADD CONSTRAINT "financing_scenarios_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'insurance_quotes')) IS NOT NULL THEN
    ALTER TABLE "insurance_quotes" ADD CONSTRAINT "insurance_quotes_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'insurance_policies')) IS NOT NULL THEN
    ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'message_thread_participants')) IS NOT NULL THEN
    ALTER TABLE "message_thread_participants" ADD CONSTRAINT "message_thread_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'messages')) IS NOT NULL THEN
    ALTER TABLE "messages" ADD CONSTRAINT "messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_applications')) IS NOT NULL THEN
    ALTER TABLE "refinance_applications" ADD CONSTRAINT "refinance_applications_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "buyers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'refinance_compliance_logs')) IS NOT NULL THEN
    ALTER TABLE "refinance_compliance_logs" ADD CONSTRAINT "refinance_compliance_logs_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "refinance_applications"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'dealer_feed_configs')) IS NOT NULL THEN
    ALTER TABLE "dealer_feed_configs" ADD CONSTRAINT "dealer_feed_configs_dealer_id_fkey" FOREIGN KEY ("dealer_id") REFERENCES "dealers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'inventory_sync_runs')) IS NOT NULL THEN
    ALTER TABLE "inventory_sync_runs" ADD CONSTRAINT "inventory_sync_runs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "inventory_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'affiliate_payouts')) IS NOT NULL THEN
    ALTER TABLE "affiliate_payouts" ADD CONSTRAINT "affiliate_payouts_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "affiliates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF to_regclass(format('%I.%I', current_schema(), 'contract_versions')) IS NOT NULL THEN
    ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
