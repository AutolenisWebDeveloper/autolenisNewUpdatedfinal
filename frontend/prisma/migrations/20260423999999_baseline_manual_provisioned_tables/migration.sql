-- ============================================================================
-- Baseline: manual-provisioned tables (reconciliation migration)
--
-- WHY: 43 models declared in schema.prisma were historically created directly
-- in Supabase (via the manual SQL in prisma/migrations/manual_supabase_sql and
-- frontend/migrations) and never had a Prisma `CREATE TABLE` migration. A fresh
-- `prisma migrate deploy` therefore could not provision them, breaking new
-- environments. This migration makes Prisma the single source of truth: it
-- (re)creates those tables, their enums and indexes so deploy alone fully
-- builds any environment.
--
-- DDL was reverse-engineered from the production database (project
-- aieybibvewmvrubcpthm), which has zero column/table drift against schema.prisma.
--
-- ORDERING: this runs immediately after the core 0423 schema and BEFORE every
-- migration that ALTERs these tables (0802, 0905, 0915, 0916, tier0). Foreign
-- keys are deferred to 20260917000000_baseline_manual_provisioned_fks so that
-- table-creation order is irrelevant.
--
-- IDEMPOTENT: every statement is guarded (CREATE TYPE via DO block, CREATE
-- TABLE/INDEX IF NOT EXISTS), so on environments already provisioned out of
-- band (e.g. production) this migration is a safe no-op.
-- ============================================================================

-- Enums
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ArticleStatus') THEN CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'REVIEW_NEEDED', 'PUBLISHED', 'ARCHIVED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DealerProspectStatus') THEN CREATE TYPE "DealerProspectStatus" AS ENUM ('DISCOVERED', 'SCRIPTED', 'DRAFTED', 'CONTACTED', 'REPLIED', 'ONBOARDED', 'DEAD'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SocialPostStatus') THEN CREATE TYPE "SocialPostStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'SKIPPED', 'REJECTED'); END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SocialVideoStatus') THEN CREATE TYPE "SocialVideoStatus" AS ENUM ('SCRIPT_READY', 'VIDEO_QUEUED', 'VIDEO_GENERATING', 'VIDEO_READY', 'VIDEO_FAILED', 'PUBLISH_READY'); END IF; END $$;

-- Tables (no foreign keys — see 20260917000000_baseline_manual_provisioned_fks)
CREATE TABLE IF NOT EXISTS "ab_test_groups" (
    "id" text NOT NULL,
    "name" text NOT NULL,
    "platform" text NOT NULL,
    "franchise_slug" text NOT NULL,
    "status" text NOT NULL DEFAULT 'RUNNING'::text,
    "winner_id" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "completed_at" timestamp with time zone,
    CONSTRAINT "ab_test_groups_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "ab_test_variants" (
    "id" text NOT NULL,
    "group_id" text NOT NULL,
    "post_id" text NOT NULL,
    "hook_type" text NOT NULL,
    "hook" text NOT NULL,
    "variant_label" text NOT NULL,
    "is_winner" boolean NOT NULL DEFAULT false,
    "score" double precision NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "ab_test_variants_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "acquisition_conversations" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" text NOT NULL,
    "buyer_id" text,
    "transcript" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "completed" boolean NOT NULL DEFAULT false,
    "extracted_data" jsonb,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "acquisition_conversations_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "affiliate_documents" (
    "id" text NOT NULL,
    "affiliate_id" text NOT NULL,
    "document_type" text NOT NULL,
    "file_url" text NOT NULL,
    "file_name" text,
    "file_size" integer,
    "status" text NOT NULL DEFAULT 'PENDING'::text,
    "reviewed_at" timestamp without time zone,
    "reviewed_by" text,
    "rejection_reason" text,
    "created_at" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" text,
    "file_size_bytes" bigint,
    "uploaded_at" timestamp without time zone NOT NULL DEFAULT now(),
    "notes" text,
    CONSTRAINT "affiliate_documents_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "affiliate_payout_methods" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "affiliate_id" text NOT NULL,
    "method" text NOT NULL DEFAULT 'CHECK'::text,
    "bank_name" text,
    "account_type" text,
    "routing_number_last4" text,
    "account_number_last4" text,
    "zelle_email" text,
    "paypal_email" text,
    "tax_id_last4" text,
    "business_name" text,
    "tax_classification" text,
    "verified_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "affiliate_payout_methods_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "ai_media_generations" (
    "id" text NOT NULL,
    "provider" text NOT NULL DEFAULT 'higgsfield'::text,
    "endpoint" text NOT NULL,
    "generation_type" text NOT NULL,
    "prompt" text NOT NULL,
    "input_images" jsonb,
    "input_audio" jsonb,
    "input_payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "higgsfield_request_id" text,
    "status" text NOT NULL DEFAULT 'queued'::text,
    "status_url" text,
    "cancel_url" text,
    "output_images" jsonb,
    "output_video_url" text,
    "output_raw" jsonb,
    "error_message" text,
    "nsfw_flagged" boolean NOT NULL DEFAULT false,
    "created_by_id" text,
    "vehicle_id" text,
    "article_id" text,
    "social_post_id" text,
    "campaign_id" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "completed_at" timestamp with time zone,
    CONSTRAINT "ai_media_generations_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "amips_market_scores" (
    "id" text NOT NULL,
    "make" text NOT NULL,
    "model" text NOT NULL,
    "metro" text NOT NULL,
    "state" text NOT NULL,
    "dealer_count" integer NOT NULL DEFAULT 0,
    "overall_buyer_advantage" double precision NOT NULL,
    "score_json" text NOT NULL,
    "computed_at" timestamp(3) without time zone NOT NULL DEFAULT now(),
    "created_at" timestamp(3) without time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp(3) without time zone NOT NULL DEFAULT now(),
    CONSTRAINT "amips_market_scores_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "amips_pages" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "slug" text NOT NULL,
    "content_tier" text NOT NULL,
    "make" text,
    "model" text,
    "metro" text,
    "state" text,
    "title" text NOT NULL,
    "meta_description" text NOT NULL,
    "h1" text NOT NULL,
    "body" text NOT NULL,
    "faq_json" text,
    "market_score_json" text,
    "data_token_count" integer NOT NULL DEFAULT 0,
    "cta_type" text NOT NULL,
    "lifecycle_status" text NOT NULL DEFAULT 'ACTIVE'::text,
    "quality_gate_status" text NOT NULL,
    "quality_gate_flags" text,
    "vehicle_data_as_of" timestamp with time zone,
    "dealer_data_as_of" timestamp with time zone,
    "market_data_as_of" timestamp with time zone,
    "published_at" timestamp with time zone,
    "last_refreshed_at" timestamp with time zone,
    "impressions" integer NOT NULL DEFAULT 0,
    "clicks" integer NOT NULL DEFAULT 0,
    "leads_generated" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "amips_pages_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "auction_vehicles" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "auction_id" text NOT NULL,
    "inventory_item_id" text,
    "year" integer,
    "make" text,
    "model" text,
    "trim" text,
    "mileage" integer,
    "notes" text,
    "created_at" timestamp without time zone NOT NULL DEFAULT now(),
    CONSTRAINT "auction_vehicles_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "autolenis_intelligence" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "metro" text NOT NULL,
    "vehicle_make" text NOT NULL,
    "vehicle_model" text NOT NULL,
    "request_volume" integer NOT NULL DEFAULT 0,
    "dealer_response_rate" double precision,
    "avg_offers_received" double precision,
    "verified_savings_avg_cents" integer,
    "offer_win_rate" double precision,
    "transaction_count" integer NOT NULL DEFAULT 0,
    "period_month" text NOT NULL,
    "last_updated" timestamp with time zone NOT NULL DEFAULT now(),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "autolenis_intelligence_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "buyer_offer_review_items" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "buyer_offer_review_id" text NOT NULL,
    "dealer_submission_id" text NOT NULL,
    "vehicle_index" integer NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'PENDING'::text,
    "responded_at" timestamp without time zone,
    "buyer_note" text,
    CONSTRAINT "buyer_offer_review_items_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "buyer_offer_reviews" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "review_token" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "vehicle_offer_id" text NOT NULL,
    "buyer_email" text NOT NULL,
    "buyer_name" text NOT NULL,
    "admin_message" text,
    "sent_at" timestamp without time zone NOT NULL DEFAULT now(),
    "expires_at" timestamp without time zone,
    CONSTRAINT "buyer_offer_reviews_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "buyer_opportunities" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" text NOT NULL,
    "conversation_id" text,
    "buyer_id" text,
    "phone" text,
    "first_name" text,
    "vehicle_type" text,
    "make" text,
    "model" text,
    "body_style" text,
    "year_min" integer,
    "year_max" integer,
    "trim" text,
    "budget_type" text,
    "budget_amount" integer,
    "monthly_payment" integer,
    "timeline" text,
    "zip" text,
    "has_trade_in" boolean,
    "trade_in_details" jsonb,
    "financing_needed" boolean,
    "messages" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "completed" boolean NOT NULL DEFAULT false,
    "lead_score" integer,
    "lead_temperature" text,
    "scoring_reason" text,
    "founder_notified" boolean NOT NULL DEFAULT false,
    "buyer_sms_sent" boolean NOT NULL DEFAULT false,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "email" text,
    "buyer_email_sent" boolean NOT NULL DEFAULT false,
    "founder_email_sent" boolean NOT NULL DEFAULT false,
    "market_msrp_estimate" integer,
    "market_avg_paid_price" integer,
    "market_typical_markup" text,
    "market_good_deal_target" integer,
    "market_notes" text,
    "market_enriched_at" timestamp with time zone,
    "source" text,
    "call_reason" text,
    "consent_sms" boolean DEFAULT false,
    "consent_at" timestamp with time zone,
    CONSTRAINT "buyer_opportunities_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "competitor_insights" (
    "id" text NOT NULL,
    "competitor" text NOT NULL,
    "topic" text NOT NULL,
    "content_type" text NOT NULL,
    "estimated_engagement" text NOT NULL,
    "opportunity" text NOT NULL,
    "suggested_hook" text NOT NULL DEFAULT ''::text,
    "signal_created" boolean NOT NULL DEFAULT false,
    "week_of" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "competitor_insights_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "content_articles" (
    "id" text NOT NULL,
    "slug" text NOT NULL,
    "cluster" text NOT NULL,
    "make" text,
    "model" text,
    "city" text NOT NULL,
    "state" text NOT NULL,
    "metro" text,
    "wave" integer NOT NULL DEFAULT 1,
    "target_keyword" text NOT NULL,
    "title" text NOT NULL,
    "meta_description" text NOT NULL,
    "h1" text NOT NULL,
    "body" text,
    "faq_json" text,
    "word_count" integer,
    "author_slug" text NOT NULL DEFAULT 'markist'::text,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT'::"ArticleStatus",
    "quality_score" integer,
    "quality_flags" text,
    "published_at" timestamp(3) without time zone,
    "generated_at" timestamp(3) without time zone,
    "groq_model" text,
    "search_grounded" boolean,
    "created_at" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at" timestamp(3) without time zone,
    "approved_at" timestamp(3) without time zone,
    "approved_by_admin_id" text,
    "last_published_at" timestamp(3) without time zone,
    "publish_failure_reason" text,
    "publication_version" integer NOT NULL DEFAULT 1,
    "canonical_url" text,
    "noindex" boolean NOT NULL DEFAULT false,
    "featured_image_url" text,
    "featured_image_alt" text,
    "featured_image_status" text,
    "featured_image_prompt" text,
    "featured_image_provider" text,
    "featured_image_generated_at" timestamp(3) without time zone,
    "lifecycle_status" text NOT NULL DEFAULT 'ACTIVE'::text,
    "refresh_due_at" timestamp(3) without time zone,
    "last_validated_at" timestamp(3) without time zone,
    "last_refreshed_at" timestamp(3) without time zone,
    CONSTRAINT "content_articles_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "content_attributions" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "article_slug" text NOT NULL,
    "cluster" text NOT NULL,
    "city" text NOT NULL,
    "state" text NOT NULL,
    "metro" text,
    "source" text NOT NULL,
    "buyer_opportunity_id" text,
    "email" text,
    "lead_temperature" text,
    "converted" boolean NOT NULL DEFAULT false,
    "converted_at" timestamp with time zone,
    "conversion_value_cents" integer,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "content_attributions_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "content_derivatives" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "signal_id" text,
    "source_article_id" text,
    "post_id" text NOT NULL,
    "platform" text NOT NULL,
    "derivative_type" text NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "content_derivatives_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "content_franchises" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "slug" text NOT NULL,
    "name" text NOT NULL,
    "description" text,
    "platforms" text[] NOT NULL DEFAULT '{}'::text[],
    "cadence" text NOT NULL DEFAULT 'daily'::text,
    "posting_slots" integer[] NOT NULL DEFAULT '{7,12,19}'::integer[],
    "hook_types" text[] NOT NULL DEFAULT '{}'::text[],
    "requires_review" boolean NOT NULL DEFAULT false,
    "active" boolean NOT NULL DEFAULT true,
    "avg_lead_score" double precision,
    "posts_generated" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "content_franchises_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "content_queue" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "priority_score" double precision NOT NULL,
    "content_tier" text NOT NULL,
    "make" text,
    "model" text,
    "metro" text,
    "state" text,
    "intent_template" text NOT NULL,
    "keyword_target" text NOT NULL,
    "status" text NOT NULL DEFAULT 'pending'::text,
    "failure_reason" text,
    "scheduled_date" timestamp with time zone,
    "content_page_id" text,
    "attempts" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "content_queue_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "creator_attributions" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "creator_id" text NOT NULL,
    "post_id" text NOT NULL,
    "platform" text NOT NULL,
    "platform_post_id" text,
    "tracking_code" text,
    "tracked_url" text,
    "clicks" integer NOT NULL DEFAULT 0,
    "vehicle_requests" integer NOT NULL DEFAULT 0,
    "dealer_signups" integer NOT NULL DEFAULT 0,
    "deals_won" integer NOT NULL DEFAULT 0,
    "revenue_generated" integer NOT NULL DEFAULT 0,
    "commission_earned" integer NOT NULL DEFAULT 0,
    "published_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "creator_attributions_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "creator_network" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "affiliate_id" text,
    "name" text NOT NULL,
    "email" text,
    "platform" text NOT NULL,
    "platforms" text[] NOT NULL DEFAULT '{}'::text[],
    "handle" text,
    "follower_count" integer,
    "engagement_rate" double precision,
    "niche" text,
    "city" text,
    "state" text,
    "commission_rate" double precision,
    "status" text NOT NULL DEFAULT 'PENDING'::text,
    "total_posts" integer NOT NULL DEFAULT 0,
    "total_clicks" integer NOT NULL DEFAULT 0,
    "total_requests" integer NOT NULL DEFAULT 0,
    "total_revenue" integer NOT NULL DEFAULT 0,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "creator_network_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "dealer_intelligence" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "dealer_name" text NOT NULL,
    "brand" text NOT NULL,
    "city" text NOT NULL,
    "state" text NOT NULL,
    "zip" text NOT NULL,
    "latitude" double precision,
    "longitude" double precision,
    "website" text,
    "inventory_signal" text NOT NULL DEFAULT 'normal'::text,
    "dealer_density_score" double precision,
    "dealers_within_30mi" integer,
    "data_source" text NOT NULL,
    "last_updated" timestamp with time zone NOT NULL DEFAULT now(),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "dealer_intelligence_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "dealer_offer_submissions" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "vehicle_offer_id" text NOT NULL,
    "dealership_name" text NOT NULL,
    "contact_name" text NOT NULL,
    "contact_email" text NOT NULL,
    "contact_phone" text NOT NULL,
    "vehicles" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "notes" text,
    "submitted_at" timestamp without time zone NOT NULL DEFAULT now(),
    "invite_id" text,
    "rejected" boolean DEFAULT false,
    "rejected_at" timestamp without time zone,
    "dealer_id" text,
    "documents" jsonb,
    CONSTRAINT "dealer_offer_submissions_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "dealer_outreach_log" (
    "id" uuid NOT NULL DEFAULT gen_random_uuid(),
    "dealer_prospect_id" text NOT NULL,
    "outreach_type" text NOT NULL,
    "channel" text NOT NULL,
    "subject" text,
    "body" text,
    "to_email" text,
    "from_email" text,
    "resend_id" text,
    "status" text NOT NULL,
    "error_message" text,
    "sent_at" timestamp without time zone DEFAULT now(),
    "delivered_at" timestamp without time zone,
    "replied_at" timestamp without time zone,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "outreach_sequence_step" integer DEFAULT 1,
    "follow_up_scheduled_at" timestamp without time zone,
    "reply_detected_at" timestamp without time zone,
    CONSTRAINT "dealer_outreach_log_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "dealer_prospects" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "buyer_opp_id" text,
    "name" text NOT NULL,
    "address" text,
    "city" text,
    "state" text,
    "zip" text,
    "phone" text,
    "email" text,
    "website" text,
    "brand" text,
    "source_url" text,
    "search_score" double precision,
    "distance_miles" double precision,
    "status" "DealerProspectStatus" NOT NULL DEFAULT 'DISCOVERED'::"DealerProspectStatus",
    "outreach_draft" text,
    "contacted_at" timestamp with time zone,
    "replied_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    "outreach_script" text,
    "script_drafted_at" timestamp with time zone,
    "script_attempts" integer NOT NULL DEFAULT 0,
    "founder_notes" text,
    "scripted_at" timestamp with time zone,
    "onboarded_at" timestamp with time zone,
    "dead_at" timestamp with time zone,
    "dead_reason" text,
    "email_source" text,
    "email_enriched_at" timestamp without time zone,
    "reply_detected_at" timestamp without time zone,
    "sequence_paused_at" timestamp without time zone,
    "sequence_pause_reason" text,
    "contact_name" text,
    "contact_title" text,
    "contact_phone" text,
    "contact_linkedin" text,
    "apollo_enriched_at" timestamp with time zone,
    "apollo_confidence" double precision,
    "enrichment_source" text,
    "contact_source_url" text,
    "contact_source" text,
    "contact_confidence" text,
    "contact_enriched_at" timestamp(3) without time zone,
    CONSTRAINT "dealer_prospects_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "hook_performance" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "platform" text NOT NULL,
    "hook_type" text NOT NULL,
    "avg_completion_rate" double precision,
    "avg_ctr" double precision,
    "avg_lead_score" double precision,
    "avg_vehicle_requests" double precision,
    "sample_size" integer NOT NULL DEFAULT 0,
    "last_updated" timestamp with time zone NOT NULL DEFAULT now(),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "hook_performance_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "market_intelligence" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "metro_name" text NOT NULL,
    "state" text NOT NULL,
    "population" integer,
    "vehicle_demand_score" double precision,
    "competition_score" double precision,
    "inventory_score" double precision,
    "buyer_leverage_score" double precision,
    "seasonal_notes" text,
    "last_updated" timestamp with time zone NOT NULL DEFAULT now(),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "market_intelligence_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "marketplace_intelligence" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "vehicle_make" text NOT NULL,
    "vehicle_model" text NOT NULL,
    "vehicle_trim" text,
    "metro" text NOT NULL,
    "dealers_invited" integer NOT NULL DEFAULT 0,
    "dealers_responded" integer NOT NULL DEFAULT 0,
    "response_rate" double precision,
    "time_to_first_offer_minutes" integer,
    "time_to_final_offer_minutes" integer,
    "buyer_accepted_offer" boolean,
    "avg_offers_per_request" double precision,
    "lead_to_request_conversion" double precision,
    "request_to_deal_conversion" double precision,
    "transaction_date" timestamp with time zone NOT NULL,
    "buyer_opportunity_id" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "marketplace_intelligence_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "outside_auction_invites" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "auction_id" text NOT NULL,
    "dealership_name" text NOT NULL,
    "contact_name" text NOT NULL,
    "email" text NOT NULL,
    "phone" text,
    "token" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "sent_at" timestamp without time zone NOT NULL DEFAULT now(),
    "viewed_at" timestamp without time zone,
    "responded_at" timestamp without time zone,
    "offer_id" text,
    "offer_otd_cents" integer,
    "offer_vehicle_cents" integer,
    "offer_tax_cents" integer,
    "offer_fees_cents" integer,
    "offer_notes" text,
    CONSTRAINT "outside_auction_invites_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "posting_windows" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "platform" text NOT NULL,
    "day_of_week" integer NOT NULL,
    "slot_1_hour" integer NOT NULL DEFAULT 7,
    "slot_2_hour" integer NOT NULL DEFAULT 12,
    "slot_3_hour" integer NOT NULL DEFAULT 19,
    "slot_4_hour" integer,
    "slot_5_hour" integer,
    "last_optimized_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "posting_windows_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "revenue_attributions" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "post_id" text NOT NULL,
    "utm_source" text,
    "utm_campaign" text,
    "utm_content" text,
    "utm_hook" text,
    "utm_platform" text,
    "vehicle_request_id" text,
    "deal_id" text,
    "creator_id" text,
    "affiliate_id" text,
    "deposit_amount_cents" integer,
    "fee_amount_cents" integer,
    "total_revenue_cents" integer,
    "attribution_status" text NOT NULL DEFAULT 'CLICK'::text,
    "clicked_at" timestamp with time zone,
    "requested_at" timestamp with time zone,
    "deal_won_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "revenue_attributions_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "search_cache" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "cache_key" text NOT NULL,
    "search_type" text NOT NULL,
    "zip" text,
    "make" text,
    "model" text,
    "radius_miles" integer,
    "result" jsonb NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "search_cache_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "search_intelligence" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "url" text NOT NULL,
    "content_tier" text NOT NULL,
    "search_impressions" integer NOT NULL DEFAULT 0,
    "clicks" integer NOT NULL DEFAULT 0,
    "ctr" double precision,
    "avg_position" double precision,
    "indexed_status" boolean NOT NULL DEFAULT false,
    "leads_generated" integer NOT NULL DEFAULT 0,
    "conversion_rate" double precision,
    "revenue_attribution" integer NOT NULL DEFAULT 0,
    "week_of" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "search_intelligence_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "social_intelligence_cache" (
    "id" text NOT NULL,
    "cache_key" text NOT NULL,
    "data" jsonb NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "social_intelligence_cache_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "social_leads" (
    "id" text NOT NULL,
    "social_post_id" text,
    "platform" text,
    "franchise" text,
    "utm_source" text,
    "utm_campaign" text,
    "utm_content" text,
    "utm_hook" text,
    "landing_page" text,
    "first_name" text NOT NULL,
    "last_name" text,
    "email" text NOT NULL,
    "phone" text,
    "zip" text,
    "city" text,
    "state" text,
    "vehicle_interest" text,
    "make" text,
    "model" text,
    "budget" text,
    "timeline" text,
    "buyer_opp_id" text,
    "vehicle_request_id" text,
    "status" text NOT NULL DEFAULT 'NEW'::text,
    "nurture_sequence" text,
    "nurture_step" integer NOT NULL DEFAULT 0,
    "last_email_sent_at" timestamp with time zone,
    "converted_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "social_leads_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "social_performance" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "post_id" text NOT NULL,
    "impressions" integer NOT NULL DEFAULT 0,
    "reach" integer NOT NULL DEFAULT 0,
    "views" integer NOT NULL DEFAULT 0,
    "watch_time_pct" double precision,
    "completion_rate" double precision,
    "likes" integer NOT NULL DEFAULT 0,
    "comments" integer NOT NULL DEFAULT 0,
    "shares" integer NOT NULL DEFAULT 0,
    "saves" integer NOT NULL DEFAULT 0,
    "link_clicks" integer NOT NULL DEFAULT 0,
    "profile_visits" integer NOT NULL DEFAULT 0,
    "vehicle_requests" integer NOT NULL DEFAULT 0,
    "dealer_signups" integer NOT NULL DEFAULT 0,
    "dealer_bids" integer NOT NULL DEFAULT 0,
    "deals_won" integer NOT NULL DEFAULT 0,
    "revenue_generated" integer NOT NULL DEFAULT 0,
    "lead_score" integer NOT NULL DEFAULT 0,
    "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "social_performance_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "social_posts" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "franchise_id" text,
    "signal_id" text,
    "source_article_id" text,
    "source_vehicle_request_id" text,
    "platform" text NOT NULL,
    "content_type" text NOT NULL,
    "hook_type" text,
    "hook" text NOT NULL,
    "script" text NOT NULL,
    "caption" text NOT NULL,
    "hashtags" text[] NOT NULL DEFAULT '{}'::text[],
    "cta_text" text,
    "cta_placement" text,
    "visual_prompt" text,
    "visual_style" text,
    "voiceover_text" text,
    "on_screen_text" text,
    "duration_seconds" integer,
    "geo_target" text,
    "make" text,
    "model" text,
    "metro" text,
    "state" text,
    "funnel_destination" text,
    "utm_source" text,
    "utm_medium" text,
    "utm_campaign" text,
    "utm_content" text,
    "utm_term" text,
    "utm_hook" text,
    "utm_platform" text,
    "tracked_url" text,
    "compliance_notes" text,
    "requires_review" boolean NOT NULL DEFAULT false,
    "automation_mode" text NOT NULL DEFAULT 'HYBRID_AUTO'::text,
    "status" "SocialPostStatus" NOT NULL DEFAULT 'DRAFT'::"SocialPostStatus",
    "rejection_reason" text,
    "scheduled_at" timestamp with time zone,
    "published_at" timestamp with time zone,
    "publishing_provider" text,
    "platform_post_id" text,
    "publish_error" text,
    "publish_attempts" integer NOT NULL DEFAULT 0,
    "lead_score" integer NOT NULL DEFAULT 0,
    "creator_id" text,
    "affiliate_id" text,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "social_posts_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "social_videos" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "post_id" text NOT NULL,
    "provider" text NOT NULL DEFAULT 'higgsfield'::text,
    "provider_job_id" text,
    "status" "SocialVideoStatus" NOT NULL DEFAULT 'SCRIPT_READY'::"SocialVideoStatus",
    "visual_prompt" text,
    "duration_seconds" integer,
    "style" text,
    "video_url" text,
    "thumbnail_url" text,
    "file_size" integer,
    "duration_actual" double precision,
    "last_polled_at" timestamp with time zone,
    "poll_attempts" integer NOT NULL DEFAULT 0,
    "error_message" text,
    "retry_count" integer NOT NULL DEFAULT 0,
    "storage_path" text,
    "storage_bucket" text,
    "generated_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "social_videos_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "topic_signals" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "signal_type" text NOT NULL,
    "make" text,
    "model" text,
    "city" text,
    "metro" text,
    "state" text,
    "signal_value" double precision,
    "signal_delta" double precision,
    "signal_context" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "source_table" text,
    "source_id" text,
    "assets_generated" boolean NOT NULL DEFAULT false,
    "asset_count" integer NOT NULL DEFAULT 0,
    "detected_at" timestamp with time zone NOT NULL DEFAULT now(),
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "topic_signals_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "vehicle_intelligence" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "make" text NOT NULL,
    "model" text NOT NULL,
    "trim" text,
    "year" integer NOT NULL,
    "msrp_cents" integer NOT NULL,
    "fair_market_low_cents" integer NOT NULL,
    "fair_market_high_cents" integer NOT NULL,
    "aggressive_target_cents" integer NOT NULL,
    "active_incentives" text,
    "incentives_expires_at" timestamp with time zone,
    "financing_notes" text,
    "lease_notes" text,
    "negotiation_difficulty" text NOT NULL,
    "data_source" text NOT NULL,
    "last_updated" timestamp with time zone NOT NULL DEFAULT now(),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "vehicle_intelligence_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "vehicle_offer_dealer_invites" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "vehicle_offer_id" text NOT NULL,
    "token" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "dealership_name" text NOT NULL,
    "contact_name" text,
    "dealer_email" text NOT NULL,
    "dealer_phone" text,
    "status" text NOT NULL DEFAULT 'sent'::text,
    "sent_at" timestamp without time zone NOT NULL DEFAULT now(),
    "opened_at" timestamp without time zone,
    "submitted_at" timestamp without time zone,
    "expires_at" timestamp without time zone,
    "submission_id" text,
    CONSTRAINT "vehicle_offer_dealer_invites_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "vehicle_offers" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "token" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "vehicle_year" integer NOT NULL,
    "vehicle_make" text NOT NULL,
    "vehicle_model" text NOT NULL,
    "vehicle_trim" text,
    "vehicle_mileage" integer,
    "vehicle_vin" text,
    "vehicle_color" text,
    "vehicle_condition" text NOT NULL,
    "asking_price_cents" integer,
    "vehicle_reference_url" text,
    "buyer_budget" text NOT NULL,
    "buyer_zip" text NOT NULL,
    "buyer_new_or_used" text NOT NULL,
    "buyer_financing" text NOT NULL,
    "buyer_email" text,
    "buyer_name" text,
    "admin_notes" text,
    "reference_id" text,
    "expires_at" timestamp without time zone,
    "created_by_admin_id" text NOT NULL,
    "created_at" timestamp without time zone NOT NULL DEFAULT now(),
    "vehicle_interior_color" text,
    "buyer_phone" text,
    "buyer_city" text,
    "buyer_state" text,
    "buyer_monthly_payment" text,
    "buyer_down_payment" text,
    "buyer_timeline" text,
    "buyer_open_to_alt" boolean DEFAULT false,
    "buyer_must_have" text,
    "buyer_drivetrain" text,
    "buyer_fuel_type" text,
    "buyer_max_mileage" text,
    "buyer_seating" text,
    "buyer_interior_color" text,
    "buyer_has_trade_in" boolean DEFAULT false,
    "buyer_trade_year" text,
    "buyer_trade_make" text,
    "buyer_trade_model" text,
    "buyer_trade_mileage" text,
    "buyer_trade_payoff" text,
    "buyer_trade_condition" text,
    "buyer_trade_vin" text,
    "buyer_trade_accident" text,
    "request_status" text DEFAULT 'new'::text,
    CONSTRAINT "vehicle_offers_pkey" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS "winning_patterns" (
    "id" text NOT NULL DEFAULT (gen_random_uuid())::text,
    "platform" text NOT NULL,
    "franchise_slug" text,
    "hook_type" text,
    "content_type" text,
    "geo_target" text,
    "make" text,
    "day_of_week" integer,
    "hour" integer,
    "avg_ctr" double precision,
    "avg_engagement" double precision,
    "avg_lead_score" double precision,
    "avg_vehicle_requests" double precision,
    "avg_revenue" double precision,
    "sample_size" integer NOT NULL DEFAULT 0,
    "last_updated" timestamp with time zone NOT NULL DEFAULT now(),
    "created_at" timestamp with time zone NOT NULL DEFAULT now(),
    "avg_completion_rate" double precision,
    CONSTRAINT "winning_patterns_pkey" PRIMARY KEY (id)
);

-- Indexes (includes unique indexes backing @unique)
CREATE INDEX IF NOT EXISTS ab_test_groups_platform_status_idx ON public.ab_test_groups USING btree (platform, status);
CREATE UNIQUE INDEX IF NOT EXISTS ab_test_variants_group_post_idx ON public.ab_test_variants USING btree (group_id, post_id);
CREATE INDEX IF NOT EXISTS acquisition_conversations_buyer_id_idx ON public.acquisition_conversations USING btree (buyer_id);
CREATE INDEX IF NOT EXISTS acquisition_conversations_session_id_idx ON public.acquisition_conversations USING btree (session_id);
CREATE UNIQUE INDEX IF NOT EXISTS acquisition_conversations_session_id_key ON public.acquisition_conversations USING btree (session_id);
CREATE INDEX IF NOT EXISTS idx_affiliate_documents_affiliate_id ON public.affiliate_documents USING btree (affiliate_id);
CREATE UNIQUE INDEX IF NOT EXISTS affiliate_payout_methods_affiliate_id_key ON public.affiliate_payout_methods USING btree (affiliate_id);
CREATE INDEX IF NOT EXISTS ai_media_gen_post_id_idx ON public.ai_media_generations USING btree (social_post_id);
CREATE INDEX IF NOT EXISTS ai_media_gen_request_id_idx ON public.ai_media_generations USING btree (higgsfield_request_id);
CREATE INDEX IF NOT EXISTS ai_media_gen_status_idx ON public.ai_media_generations USING btree (status);
CREATE UNIQUE INDEX IF NOT EXISTS ai_media_generations_higgsfield_request_id_key ON public.ai_media_generations USING btree (higgsfield_request_id);
CREATE UNIQUE INDEX IF NOT EXISTS amips_market_scores_make_model_metro_key ON public.amips_market_scores USING btree (make, model, metro);
CREATE INDEX IF NOT EXISTS amips_market_scores_metro_idx ON public.amips_market_scores USING btree (metro);
CREATE INDEX IF NOT EXISTS amips_market_scores_overall_idx ON public.amips_market_scores USING btree (overall_buyer_advantage);
CREATE INDEX IF NOT EXISTS amips_pages_lifecycle_status_idx ON public.amips_pages USING btree (lifecycle_status);
CREATE INDEX IF NOT EXISTS amips_pages_make_model_metro_idx ON public.amips_pages USING btree (make, model, metro);
CREATE INDEX IF NOT EXISTS amips_pages_published_at_idx ON public.amips_pages USING btree (published_at);
CREATE UNIQUE INDEX IF NOT EXISTS amips_pages_slug_key ON public.amips_pages USING btree (slug);
CREATE INDEX IF NOT EXISTS amips_pages_tier_lifecycle_idx ON public.amips_pages USING btree (content_tier, lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_av_auction ON public.auction_vehicles USING btree (auction_id);
CREATE INDEX IF NOT EXISTS autolenis_intelligence_metro_idx ON public.autolenis_intelligence USING btree (metro);
CREATE UNIQUE INDEX IF NOT EXISTS autolenis_intelligence_metro_make_model_period_key ON public.autolenis_intelligence USING btree (metro, vehicle_make, vehicle_model, period_month);
CREATE INDEX IF NOT EXISTS autolenis_intelligence_transaction_count_idx ON public.autolenis_intelligence USING btree (transaction_count);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_offer_reviews_review_token_key ON public.buyer_offer_reviews USING btree (review_token);
CREATE INDEX IF NOT EXISTS buyer_opportunities_buyer_id_idx ON public.buyer_opportunities USING btree (buyer_id);
CREATE INDEX IF NOT EXISTS buyer_opportunities_call_reason_idx ON public.buyer_opportunities USING btree (call_reason);
CREATE INDEX IF NOT EXISTS buyer_opportunities_created_at_idx ON public.buyer_opportunities USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS buyer_opportunities_email_idx ON public.buyer_opportunities USING btree (email);
CREATE INDEX IF NOT EXISTS buyer_opportunities_phone_idx ON public.buyer_opportunities USING btree (phone);
CREATE UNIQUE INDEX IF NOT EXISTS buyer_opportunities_session_id_key ON public.buyer_opportunities USING btree (session_id);
CREATE INDEX IF NOT EXISTS buyer_opportunities_source_idx ON public.buyer_opportunities USING btree (source);
CREATE INDEX IF NOT EXISTS buyer_opportunities_temperature_idx ON public.buyer_opportunities USING btree (lead_temperature);
CREATE INDEX IF NOT EXISTS competitor_insights_week_idx ON public.competitor_insights USING btree (week_of);
CREATE INDEX IF NOT EXISTS content_articles_city_state_idx ON public.content_articles USING btree (city, state);
CREATE INDEX IF NOT EXISTS content_articles_cluster_idx ON public.content_articles USING btree (cluster);
CREATE INDEX IF NOT EXISTS content_articles_cluster_status_idx ON public.content_articles USING btree (cluster, status);
CREATE INDEX IF NOT EXISTS content_articles_lifecycle_status_idx ON public.content_articles USING btree (lifecycle_status);
CREATE INDEX IF NOT EXISTS content_articles_metro_idx ON public.content_articles USING btree (metro);
CREATE INDEX IF NOT EXISTS content_articles_metro_status_idx ON public.content_articles USING btree (metro, status);
CREATE INDEX IF NOT EXISTS content_articles_noindex_idx ON public.content_articles USING btree (noindex);
CREATE INDEX IF NOT EXISTS content_articles_published_at_idx ON public.content_articles USING btree (published_at);
CREATE INDEX IF NOT EXISTS content_articles_refresh_due_at_idx ON public.content_articles USING btree (refresh_due_at);
CREATE INDEX IF NOT EXISTS content_articles_scheduled_at_idx ON public.content_articles USING btree (scheduled_at);
CREATE UNIQUE INDEX IF NOT EXISTS content_articles_slug_key ON public.content_articles USING btree (slug);
CREATE INDEX IF NOT EXISTS content_articles_status_idx ON public.content_articles USING btree (status);
CREATE INDEX IF NOT EXISTS content_articles_wave_idx ON public.content_articles USING btree (wave);
CREATE INDEX IF NOT EXISTS content_attributions_article_slug_idx ON public.content_attributions USING btree (article_slug);
CREATE INDEX IF NOT EXISTS content_attributions_buyer_opp_idx ON public.content_attributions USING btree (buyer_opportunity_id);
CREATE INDEX IF NOT EXISTS content_attributions_city_state_idx ON public.content_attributions USING btree (city, state);
CREATE INDEX IF NOT EXISTS content_attributions_cluster_idx ON public.content_attributions USING btree (cluster);
CREATE INDEX IF NOT EXISTS content_attributions_converted_idx ON public.content_attributions USING btree (converted);
CREATE INDEX IF NOT EXISTS content_attributions_metro_idx ON public.content_attributions USING btree (metro);
CREATE INDEX IF NOT EXISTS content_derivatives_post_id_idx ON public.content_derivatives USING btree (post_id);
CREATE INDEX IF NOT EXISTS content_derivatives_signal_id_idx ON public.content_derivatives USING btree (signal_id);
CREATE INDEX IF NOT EXISTS content_derivatives_source_article_id_idx ON public.content_derivatives USING btree (source_article_id);
CREATE INDEX IF NOT EXISTS content_franchises_active_idx ON public.content_franchises USING btree (active);
CREATE INDEX IF NOT EXISTS content_franchises_slug_idx ON public.content_franchises USING btree (slug);
CREATE UNIQUE INDEX IF NOT EXISTS content_franchises_slug_key ON public.content_franchises USING btree (slug);
CREATE INDEX IF NOT EXISTS content_queue_content_tier_idx ON public.content_queue USING btree (content_tier);
CREATE INDEX IF NOT EXISTS content_queue_scheduled_date_idx ON public.content_queue USING btree (scheduled_date);
CREATE INDEX IF NOT EXISTS content_queue_status_priority_idx ON public.content_queue USING btree (status, priority_score);
CREATE INDEX IF NOT EXISTS creator_attributions_creator_id_idx ON public.creator_attributions USING btree (creator_id);
CREATE INDEX IF NOT EXISTS creator_attributions_post_id_idx ON public.creator_attributions USING btree (post_id);
CREATE INDEX IF NOT EXISTS creator_network_platform_idx ON public.creator_network USING btree (platform);
CREATE INDEX IF NOT EXISTS creator_network_status_idx ON public.creator_network USING btree (status);
CREATE INDEX IF NOT EXISTS dealer_intelligence_brand_city_state_idx ON public.dealer_intelligence USING btree (brand, city, state);
CREATE INDEX IF NOT EXISTS dealer_intelligence_last_updated_idx ON public.dealer_intelligence USING btree (last_updated);
CREATE INDEX IF NOT EXISTS dealer_intelligence_state_idx ON public.dealer_intelligence USING btree (state);
CREATE UNIQUE INDEX IF NOT EXISTS dealer_offer_submissions_invite_id_key ON public.dealer_offer_submissions USING btree (invite_id);
CREATE INDEX IF NOT EXISTS idx_dos_dealer_id ON public.dealer_offer_submissions USING btree (dealer_id);
CREATE INDEX IF NOT EXISTS dealer_outreach_log_dealer_idx ON public.dealer_outreach_log USING btree (dealer_prospect_id);
CREATE INDEX IF NOT EXISTS dealer_outreach_log_resend_id_idx ON public.dealer_outreach_log USING btree (resend_id);
CREATE INDEX IF NOT EXISTS dealer_outreach_log_sent_at_idx ON public.dealer_outreach_log USING btree (sent_at);
CREATE INDEX IF NOT EXISTS dealer_outreach_log_status_idx ON public.dealer_outreach_log USING btree (status);
CREATE INDEX IF NOT EXISTS outreach_log_sequence_step_idx ON public.dealer_outreach_log USING btree (outreach_sequence_step);
CREATE INDEX IF NOT EXISTS dealer_prospects_buyer_opp_id_idx ON public.dealer_prospects USING btree (buyer_opp_id);
CREATE INDEX IF NOT EXISTS dealer_prospects_email_idx ON public.dealer_prospects USING btree (email) WHERE (email IS NOT NULL);
CREATE INDEX IF NOT EXISTS dealer_prospects_email_source_idx ON public.dealer_prospects USING btree (email_source);
CREATE INDEX IF NOT EXISTS dealer_prospects_reply_idx ON public.dealer_prospects USING btree (reply_detected_at) WHERE (reply_detected_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS dealer_prospects_status_buyer_idx ON public.dealer_prospects USING btree (status, buyer_opp_id);
CREATE INDEX IF NOT EXISTS dealer_prospects_status_created_idx ON public.dealer_prospects USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS dealer_prospects_status_idx ON public.dealer_prospects USING btree (status);
CREATE INDEX IF NOT EXISTS dealer_prospects_zip_idx ON public.dealer_prospects USING btree (zip);
CREATE UNIQUE INDEX IF NOT EXISTS hook_performance_platform_hook_type_key ON public.hook_performance USING btree (platform, hook_type);
CREATE INDEX IF NOT EXISTS market_intelligence_buyer_leverage_score_idx ON public.market_intelligence USING btree (buyer_leverage_score);
CREATE UNIQUE INDEX IF NOT EXISTS market_intelligence_metro_name_state_key ON public.market_intelligence USING btree (metro_name, state);
CREATE INDEX IF NOT EXISTS market_intelligence_state_idx ON public.market_intelligence USING btree (state);
CREATE INDEX IF NOT EXISTS marketplace_intelligence_make_model_idx ON public.marketplace_intelligence USING btree (vehicle_make, vehicle_model);
CREATE INDEX IF NOT EXISTS marketplace_intelligence_metro_idx ON public.marketplace_intelligence USING btree (metro);
CREATE INDEX IF NOT EXISTS marketplace_intelligence_transaction_date_idx ON public.marketplace_intelligence USING btree (transaction_date);
CREATE INDEX IF NOT EXISTS idx_oai_auction ON public.outside_auction_invites USING btree (auction_id);
CREATE UNIQUE INDEX IF NOT EXISTS outside_auction_invites_offer_id_key ON public.outside_auction_invites USING btree (offer_id);
CREATE UNIQUE INDEX IF NOT EXISTS outside_auction_invites_token_key ON public.outside_auction_invites USING btree (token);
CREATE UNIQUE INDEX IF NOT EXISTS posting_windows_platform_day_of_week_key ON public.posting_windows USING btree (platform, day_of_week);
CREATE INDEX IF NOT EXISTS revenue_attributions_deal_id_idx ON public.revenue_attributions USING btree (deal_id);
CREATE INDEX IF NOT EXISTS revenue_attributions_post_id_idx ON public.revenue_attributions USING btree (post_id);
CREATE INDEX IF NOT EXISTS revenue_attributions_status_idx ON public.revenue_attributions USING btree (attribution_status);
CREATE INDEX IF NOT EXISTS revenue_attributions_vehicle_request_id_idx ON public.revenue_attributions USING btree (vehicle_request_id);
CREATE INDEX IF NOT EXISTS search_cache_cache_key_idx ON public.search_cache USING btree (cache_key);
CREATE UNIQUE INDEX IF NOT EXISTS search_cache_cache_key_key ON public.search_cache USING btree (cache_key);
CREATE INDEX IF NOT EXISTS search_cache_expires_at_idx ON public.search_cache USING btree (expires_at);
CREATE INDEX IF NOT EXISTS search_intelligence_content_tier_idx ON public.search_intelligence USING btree (content_tier);
CREATE INDEX IF NOT EXISTS search_intelligence_leads_generated_idx ON public.search_intelligence USING btree (leads_generated);
CREATE UNIQUE INDEX IF NOT EXISTS search_intelligence_url_week_of_key ON public.search_intelligence USING btree (url, week_of);
CREATE INDEX IF NOT EXISTS search_intelligence_week_of_idx ON public.search_intelligence USING btree (week_of);
CREATE UNIQUE INDEX IF NOT EXISTS social_intelligence_cache_cache_key_key ON public.social_intelligence_cache USING btree (cache_key);
CREATE INDEX IF NOT EXISTS social_leads_created_at_idx ON public.social_leads USING btree (created_at);
CREATE INDEX IF NOT EXISTS social_leads_email_idx ON public.social_leads USING btree (email);
CREATE INDEX IF NOT EXISTS social_leads_platform_idx ON public.social_leads USING btree (platform);
CREATE INDEX IF NOT EXISTS social_leads_post_id_idx ON public.social_leads USING btree (social_post_id);
CREATE INDEX IF NOT EXISTS social_leads_status_idx ON public.social_leads USING btree (status);
CREATE INDEX IF NOT EXISTS social_performance_post_id_idx ON public.social_performance USING btree (post_id);
CREATE INDEX IF NOT EXISTS social_performance_recorded_at_idx ON public.social_performance USING btree (recorded_at);
CREATE INDEX IF NOT EXISTS social_posts_created_at_idx ON public.social_posts USING btree (created_at);
CREATE INDEX IF NOT EXISTS social_posts_franchise_id_idx ON public.social_posts USING btree (franchise_id);
CREATE INDEX IF NOT EXISTS social_posts_platform_status_idx ON public.social_posts USING btree (platform, status);
CREATE INDEX IF NOT EXISTS social_posts_scheduled_at_idx ON public.social_posts USING btree (scheduled_at);
CREATE INDEX IF NOT EXISTS social_posts_signal_id_idx ON public.social_posts USING btree (signal_id);
CREATE INDEX IF NOT EXISTS social_posts_status_idx ON public.social_posts USING btree (status);
CREATE INDEX IF NOT EXISTS social_videos_post_id_idx ON public.social_videos USING btree (post_id);
CREATE UNIQUE INDEX IF NOT EXISTS social_videos_post_id_key ON public.social_videos USING btree (post_id);
CREATE INDEX IF NOT EXISTS social_videos_provider_job_id_idx ON public.social_videos USING btree (provider_job_id);
CREATE INDEX IF NOT EXISTS social_videos_status_idx ON public.social_videos USING btree (status);
CREATE INDEX IF NOT EXISTS topic_signals_assets_generated_idx ON public.topic_signals USING btree (assets_generated);
CREATE INDEX IF NOT EXISTS topic_signals_detected_at_idx ON public.topic_signals USING btree (detected_at);
CREATE INDEX IF NOT EXISTS topic_signals_expires_at_idx ON public.topic_signals USING btree (expires_at);
CREATE INDEX IF NOT EXISTS topic_signals_make_model_city_idx ON public.topic_signals USING btree (make, model, city);
CREATE INDEX IF NOT EXISTS topic_signals_type_idx ON public.topic_signals USING btree (signal_type);
CREATE INDEX IF NOT EXISTS vehicle_intelligence_last_updated_idx ON public.vehicle_intelligence USING btree (last_updated);
CREATE INDEX IF NOT EXISTS vehicle_intelligence_make_model_idx ON public.vehicle_intelligence USING btree (make, model);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_intelligence_make_model_trim_year_key ON public.vehicle_intelligence USING btree (make, model, "trim", year) NULLS NOT DISTINCT;
CREATE INDEX IF NOT EXISTS idx_dealer_invites_token ON public.vehicle_offer_dealer_invites USING btree (token);
CREATE INDEX IF NOT EXISTS idx_dealer_invites_vehicle_offer ON public.vehicle_offer_dealer_invites USING btree (vehicle_offer_id);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_offer_dealer_invites_submission_id_key ON public.vehicle_offer_dealer_invites USING btree (submission_id);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_offer_dealer_invites_token_key ON public.vehicle_offer_dealer_invites USING btree (token);
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_offers_token_key ON public.vehicle_offers USING btree (token);

CREATE INDEX IF NOT EXISTS winning_patterns_platform_franchise_idx ON public.winning_patterns USING btree (platform, franchise_slug);
CREATE INDEX IF NOT EXISTS winning_patterns_platform_hook_idx ON public.winning_patterns USING btree (platform, hook_type);
