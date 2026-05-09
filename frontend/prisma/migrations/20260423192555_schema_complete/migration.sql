-- CreateTable
CREATE TABLE "admin_sessions" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_login_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "ip_address" TEXT,
    "fail_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "circumvention_attempts" (
    "id" TEXT NOT NULL,
    "thread_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "flag" "AntiCircumventionFlag" NOT NULL,
    "pattern" TEXT NOT NULL,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by" TEXT,

    CONSTRAINT "circumvention_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "identity_firewall_entries" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT,
    "dealer_id" TEXT,
    "flag" "AntiCircumventionFlag" NOT NULL,
    "description" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "identity_firewall_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_kill_switch_logs" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "reason" TEXT,
    "admin_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_kill_switch_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_events" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "hit_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rate_limit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "csrf_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "user_id" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "csrf_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_status_history" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "from_status" TEXT NOT NULL,
    "to_status" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_fee_payments" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "deposit_credit_cents" INTEGER NOT NULL,
    "net_amount_cents" INTEGER NOT NULL,
    "stripe_payment_intent_id" TEXT,
    "paid_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_fee_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auction_extension_logs" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "extended_by" TEXT NOT NULL,
    "hours_added" INTEGER NOT NULL,
    "original_end" TIMESTAMP(3) NOT NULL,
    "new_end" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auction_extension_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_capacity_configs" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "max_auction_load" INTEGER NOT NULL DEFAULT 5,
    "preferred_makes" TEXT[],
    "preferred_price_min" INTEGER,
    "preferred_price_max" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dealer_capacity_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "junk_fee_patterns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keywords" TEXT[],
    "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
    "category" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "junk_fee_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "best_price_calculation_logs" (
    "id" TEXT NOT NULL,
    "auction_id" TEXT NOT NULL,
    "term_months" INTEGER NOT NULL,
    "offer_count" INTEGER NOT NULL,
    "weights" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "best_price_calculation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_snapshots" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "total_revenue" INTEGER NOT NULL,
    "deals_completed" INTEGER NOT NULL,
    "avg_deal_value" INTEGER NOT NULL,
    "projected_revenue" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_timeline" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "actor_id" TEXT,
    "actor_role" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_timeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_filters" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "name" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year_min" INTEGER,
    "year_max" INTEGER,
    "price_max" INTEGER,
    "mileage_max" INTEGER,
    "body_style" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "search_filters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_inventory_preferences" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "preferred_makes" TEXT[],
    "preferred_body_styles" TEXT[],
    "max_mileage" INTEGER,
    "min_year" INTEGER,
    "features" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_inventory_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_match_scores" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "factors" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_match_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_comparisons_saved" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "vehicle_ids" TEXT[],
    "name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_comparisons_saved_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_price_alerts" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "target_price_cents" INTEGER NOT NULL,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_price_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "auction_updates" BOOLEAN NOT NULL DEFAULT true,
    "deal_updates" BOOLEAN NOT NULL DEFAULT true,
    "commission_updates" BOOLEAN NOT NULL DEFAULT true,
    "marketing_emails" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_batches" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "notification_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_read_receipts" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_read_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_alerts" (
    "id" TEXT NOT NULL,
    "level" "HealthAlertLevel" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "is_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_check_logs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "database" BOOLEAN NOT NULL,
    "inventory_health" INTEGER NOT NULL,
    "active_auctions" INTEGER NOT NULL,
    "pending_ofac" INTEGER NOT NULL,
    "alerts" JSONB NOT NULL DEFAULT '[]',
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_check_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_referrals" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "referred_user_id" TEXT NOT NULL,
    "referral_code" TEXT NOT NULL,
    "signed_up_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "first_deal_at" TIMESTAMP(3),
    "total_deals" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "affiliate_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_compliance_records" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "status" "AffiliateComplianceStatus" NOT NULL DEFAULT 'PENDING_ACKNOWLEDGMENT',
    "acknowledged_at" TIMESTAMP(3),
    "disclosure_version" TEXT,
    "violations" JSONB NOT NULL DEFAULT '[]',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_compliance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_tier_history" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "fromTier" "AffiliateTier" NOT NULL,
    "toTier" "AffiliateTier" NOT NULL,
    "reason" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_tier_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliate_payout_schedules" (
    "id" TEXT NOT NULL,
    "affiliate_id" TEXT NOT NULL,
    "payout_day" INTEGER NOT NULL DEFAULT 1,
    "minimum_cents" INTEGER NOT NULL DEFAULT 2500,
    "method" TEXT NOT NULL DEFAULT 'BANK_TRANSFER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "affiliate_payout_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_payments" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "deal_id" TEXT,
    "amount_cents" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_configurations" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_quality_scores" (
    "id" TEXT NOT NULL,
    "inventory_item_id" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "photo_score" INTEGER NOT NULL,
    "data_score" INTEGER NOT NULL,
    "vin_verified" BOOLEAN NOT NULL DEFAULT false,
    "price_score" INTEGER NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_quality_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_feed_logs" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "feed_url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "vehicles_processed" INTEGER NOT NULL DEFAULT 0,
    "vehicles_added" INTEGER NOT NULL DEFAULT 0,
    "vehicles_updated" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "inventory_feed_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_request_match_results" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "inventory_item_id" TEXT,
    "match_score" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "price_cents" INTEGER,
    "notes" TEXT,
    "found_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_request_match_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_credit_history" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "prequal_id" TEXT NOT NULL,
    "inquiry_type" TEXT NOT NULL DEFAULT 'SOFT_PULL',
    "provider" TEXT NOT NULL DEFAULT 'MicroBilt',
    "result_summary" TEXT,
    "conducted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_credit_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_in_valuations" (
    "id" TEXT NOT NULL,
    "trade_in_id" TEXT NOT NULL,
    "market_value_cents" INTEGER,
    "trade_value_cents" INTEGER,
    "valuation_source" TEXT,
    "valued_at" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "trade_in_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "url" TEXT NOT NULL,
    "size_bytes" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_scan_rule_history" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "old_value" JSONB NOT NULL,
    "new_value" JSONB NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_scan_rule_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_scan_history" (
    "id" TEXT NOT NULL,
    "deal_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "score" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "scan_run_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggered_by" TEXT,

    CONSTRAINT "contract_scan_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_pre_approval_documents" (
    "id" TEXT NOT NULL,
    "pre_approval_id" TEXT NOT NULL,
    "document_url" TEXT NOT NULL,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),

    CONSTRAINT "external_pre_approval_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_context_cache" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "summary" TEXT,
    "keyFacts" JSONB NOT NULL DEFAULT '{}',
    "concerns" JSONB NOT NULL DEFAULT '[]',
    "last_updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_context_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_violations" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "sla_type" TEXT NOT NULL,
    "breached_at" TIMESTAMP(3) NOT NULL,
    "hours_overdue" DOUBLE PRECISION NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "sla_violations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cron_job_logs" (
    "id" TEXT NOT NULL,
    "cron_name" TEXT NOT NULL,
    "status" "CronJobStatus" NOT NULL,
    "duration" INTEGER,
    "result" JSONB,
    "error" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "cron_job_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_briefing_history" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "delivered_to" TEXT[],
    "model" TEXT NOT NULL DEFAULT 'llama-3.3-70b-versatile',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_briefing_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "best_price_weight_history" (
    "id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "weights" JSONB NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "best_price_weight_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "conditions" JSONB,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config_history" (
    "id" TEXT NOT NULL,
    "config_key" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB NOT NULL,
    "changed_by" TEXT NOT NULL,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_redirects" (
    "id" TEXT NOT NULL,
    "from_path" TEXT NOT NULL,
    "to_path" TEXT NOT NULL,
    "status_code" INTEGER NOT NULL DEFAULT 301,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seo_redirects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_sitemap_entries" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "priority" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "change_freq" TEXT NOT NULL DEFAULT 'weekly',
    "last_modified" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "seo_sitemap_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refinance_partner_analytics" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "redirect_count" INTEGER NOT NULL DEFAULT 0,
    "conversion_count" INTEGER NOT NULL DEFAULT 0,
    "avg_loan_balance" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refinance_partner_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_cohorts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "period" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "metrics" JSONB NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faith_content_audit_logs" (
    "id" TEXT NOT NULL,
    "admin_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_id" TEXT,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "faith_content_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "theme" TEXT NOT NULL DEFAULT 'light',
    "language" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_verifications" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "license_num" TEXT,
    "state" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "documents" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealer_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dealer_licenses" (
    "id" TEXT NOT NULL,
    "dealer_id" TEXT NOT NULL,
    "license_num" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3),
    "document_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dealer_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_nudge_preferences" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
    "email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "dismissed_stages" TEXT[],
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_nudge_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_sessions" (
    "id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "agent_type" TEXT NOT NULL DEFAULT 'general',
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "message_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ai_chat_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_chat_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "model" TEXT,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "api_key" TEXT,
    "base_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_mock_only" BOOLEAN NOT NULL DEFAULT false,
    "supported_states" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insurance_providers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_sessions_token_key" ON "admin_sessions"("token");

-- CreateIndex
CREATE INDEX "admin_sessions_admin_id_idx" ON "admin_sessions"("admin_id");

-- CreateIndex
CREATE INDEX "rate_limit_events_identifier_endpoint_idx" ON "rate_limit_events"("identifier", "endpoint");

-- CreateIndex
CREATE UNIQUE INDEX "csrf_tokens_token_key" ON "csrf_tokens"("token");

-- CreateIndex
CREATE INDEX "deal_status_history_deal_id_idx" ON "deal_status_history"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_fee_payments_deal_id_key" ON "service_fee_payments"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_fee_payments_stripe_payment_intent_id_key" ON "service_fee_payments"("stripe_payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_capacity_configs_dealer_id_key" ON "dealer_capacity_configs"("dealer_id");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_snapshots_period_key" ON "revenue_snapshots"("period");

-- CreateIndex
CREATE INDEX "deal_timeline_deal_id_occurred_at_idx" ON "deal_timeline"("deal_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_inventory_preferences_buyer_id_key" ON "buyer_inventory_preferences"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_match_scores_buyer_id_inventory_item_id_key" ON "vehicle_match_scores"("buyer_id", "inventory_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_user_id_key" ON "notification_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_read_receipts_message_id_user_id_key" ON "message_read_receipts"("message_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_referrals_affiliate_id_referred_user_id_key" ON "affiliate_referrals"("affiliate_id", "referred_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_compliance_records_affiliate_id_key" ON "affiliate_compliance_records"("affiliate_id");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_payout_schedules_affiliate_id_key" ON "affiliate_payout_schedules"("affiliate_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_configurations_key_key" ON "system_configurations"("key");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_quality_scores_inventory_item_id_key" ON "inventory_quality_scores"("inventory_item_id");

-- CreateIndex
CREATE INDEX "buyer_credit_history_buyer_id_idx" ON "buyer_credit_history"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_in_valuations_trade_in_id_key" ON "trade_in_valuations"("trade_in_id");

-- CreateIndex
CREATE INDEX "contract_scan_history_deal_id_idx" ON "contract_scan_history"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "ai_context_cache_buyer_id_key" ON "ai_context_cache"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_key_key" ON "feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "seo_redirects_from_path_key" ON "seo_redirects"("from_path");

-- CreateIndex
CREATE UNIQUE INDEX "seo_sitemap_entries_url_key" ON "seo_sitemap_entries"("url");

-- CreateIndex
CREATE UNIQUE INDEX "refinance_partner_analytics_partner_id_period_key" ON "refinance_partner_analytics"("partner_id", "period");

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_user_id_key" ON "user_preferences"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "dealer_verifications_dealer_id_key" ON "dealer_verifications"("dealer_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_nudge_preferences_buyer_id_key" ON "buyer_nudge_preferences"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_providers_name_key" ON "insurance_providers"("name");

-- AddForeignKey
ALTER TABLE "ai_chat_messages" ADD CONSTRAINT "ai_chat_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "ai_chat_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
