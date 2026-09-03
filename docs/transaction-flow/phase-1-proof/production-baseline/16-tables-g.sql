CREATE TABLE public.platform_alerts (
  id text NOT NULL,
  level "HealthAlertLevel" NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  source text NOT NULL,
  is_resolved boolean DEFAULT false NOT NULL,
  resolved_at timestamp(3) without time zone,
  resolved_by text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.platform_stat_snapshots (
  id text NOT NULL,
  dealers_count integer NOT NULL,
  buyers_served integer NOT NULL,
  avg_savings integer NOT NULL,
  deals_completed integer NOT NULL,
  avg_auction_bids double precision NOT NULL,
  snapshot_date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.posting_windows (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  platform text NOT NULL,
  day_of_week integer NOT NULL,
  slot_1_hour integer DEFAULT 7 NOT NULL,
  slot_2_hour integer DEFAULT 12 NOT NULL,
  slot_3_hour integer DEFAULT 19 NOT NULL,
  slot_4_hour integer,
  slot_5_hour integer,
  last_optimized_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.pre_qualifications (
  id text NOT NULL,
  buyer_id text NOT NULL,
  decision "PreQualDecision" NOT NULL,
  tier "PreQualTier",
  expires_at timestamp(3) without time zone NOT NULL,
  max_otd_amount_cents integer NOT NULL,
  check_ofac_alert boolean DEFAULT false NOT NULL,
  raw_response text,
  is_external boolean DEFAULT false NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  employment_status text,
  employer_name text,
  monthly_income_cents integer,
  length_of_employment text,
  housing_status text,
  monthly_housing_payment_cents integer,
  monthly_other_debt_cents integer,
  front_end_dti_bps integer,
  back_end_dti_bps integer,
  benchmark_apr_bps integer,
  credit_score integer,
  idv_score integer,
  mla_covered boolean DEFAULT false NOT NULL,
  fraud_warning text,
  adverse_reason_codes text[] DEFAULT '{}'::text[] NOT NULL,
  deceased_flag boolean DEFAULT false NOT NULL,
  bankruptcy_flag boolean DEFAULT false NOT NULL,
  high_risk_address_flag boolean DEFAULT false NOT NULL,
  effective_income_cents integer,
  total_monthly_obligations_cents integer
);
CREATE TABLE public.prequal_consents (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  prequal_id text NOT NULL,
  buyer_id text NOT NULL,
  consent_text text NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  terms_version text,
  accepted_at timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.rate_limit_events (
  id text NOT NULL,
  identifier text NOT NULL,
  endpoint text NOT NULL,
  hit_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.referral_milestone_configs (
  id text NOT NULL,
  milestone_code text NOT NULL,
  label text NOT NULL,
  description text,
  is_active boolean DEFAULT true NOT NULL,
  sort_order integer DEFAULT 0 NOT NULL,
  reward_cents integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.referral_milestones (
  id text NOT NULL,
  buyer_id text NOT NULL,
  milestone text NOT NULL,
  reward_type text NOT NULL,
  reward_value integer NOT NULL,
  achieved boolean DEFAULT false NOT NULL,
  achieved_at timestamp(3) without time zone,
  paid_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.refinance_applications (
  id text NOT NULL,
  buyer_id text,
  status "RefinanceStatus" DEFAULT 'SUBMITTED'::"RefinanceStatus" NOT NULL,
  vehicle_year integer NOT NULL,
  loan_balance_cents integer NOT NULL,
  redirected_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  lead_id text NOT NULL,
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text NOT NULL,
  phone text NOT NULL,
  monthly_payment_cents integer NOT NULL,
  interest_rate_band text NOT NULL,
  employment_status text NOT NULL,
  state text NOT NULL,
  consent_given boolean DEFAULT false NOT NULL,
  consent_timestamp timestamp(3) without time zone,
  ip_hash text,
  source text
);
CREATE TABLE public.refinance_compliance_logs (
  id text NOT NULL,
  application_id text NOT NULL,
  tcpa_consent boolean NOT NULL,
  consent_timestamp timestamp(3) without time zone NOT NULL,
  ip_address text,
  source text
);
CREATE TABLE public.revenue_attributions (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  post_id text NOT NULL,
  utm_source text,
  utm_campaign text,
  utm_content text,
  utm_hook text,
  utm_platform text,
  vehicle_request_id text,
  deal_id text,
  creator_id text,
  affiliate_id text,
  deposit_amount_cents integer,
  fee_amount_cents integer,
  total_revenue_cents integer,
  attribution_status text DEFAULT 'CLICK'::text NOT NULL,
  clicked_at timestamp with time zone,
  requested_at timestamp with time zone,
  deal_won_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.revenue_snapshots (
  id text NOT NULL,
  period text NOT NULL,
  total_revenue integer NOT NULL,
  deals_completed integer NOT NULL,
  avg_deal_value integer NOT NULL,
  projected_revenue integer NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.saved_searches (
  id text NOT NULL,
  buyer_id text NOT NULL,
  name text NOT NULL,
  filters jsonb NOT NULL,
  last_match_at timestamp(3) without time zone,
  match_count integer DEFAULT 0 NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.search_cache (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  cache_key text NOT NULL,
  search_type text NOT NULL,
  zip text,
  make text,
  model text,
  radius_miles integer,
  result jsonb NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.search_filters (
  id text NOT NULL,
  buyer_id text NOT NULL,
  name text,
  make text,
  model text,
  year_min integer,
  year_max integer,
  price_max integer,
  mileage_max integer,
  body_style text,
  is_default boolean DEFAULT false NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.search_intelligence (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  url text NOT NULL,
  content_tier text NOT NULL,
  search_impressions integer DEFAULT 0 NOT NULL,
  clicks integer DEFAULT 0 NOT NULL,
  ctr double precision,
  avg_position double precision,
  indexed_status boolean DEFAULT false NOT NULL,
  leads_generated integer DEFAULT 0 NOT NULL,
  conversion_rate double precision,
  revenue_attribution integer DEFAULT 0 NOT NULL,
  week_of timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.segments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  description text,
  conditions jsonb DEFAULT '{"match": "all", "rules": []}'::jsonb NOT NULL,
  contact_count integer DEFAULT 0 NOT NULL,
  last_counted_at timestamp with time zone,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.seo_health_scores (
  id text NOT NULL,
  page_slug text NOT NULL,
  score integer NOT NULL,
  issues jsonb DEFAULT '[]'::jsonb NOT NULL,
  status "SeoHealthStatus" NOT NULL,
  audited_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.seo_keywords (
  id text NOT NULL,
  keyword text NOT NULL,
  search_volume integer,
  difficulty integer,
  target_pages text[],
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.seo_page_configs (
  id text NOT NULL,
  page_slug text NOT NULL,
  title text,
  description text,
  canonical_url text,
  og_title text,
  og_description text,
  og_image text,
  schema jsonb,
  health_score integer,
  last_audit_at timestamp(3) without time zone,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.seo_redirects (
  id text NOT NULL,
  from_path text NOT NULL,
  to_path text NOT NULL,
  status_code integer DEFAULT 301 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.seo_sitemap_entries (
  id text NOT NULL,
  url text NOT NULL,
  priority double precision DEFAULT 0.5 NOT NULL,
  change_freq text DEFAULT 'weekly'::text NOT NULL,
  last_modified timestamp(3) without time zone NOT NULL,
  is_active boolean DEFAULT true NOT NULL
);
CREATE TABLE public.service_fee_payments (
  id text NOT NULL,
  deal_id text NOT NULL,
  amount_cents integer NOT NULL,
  deposit_credit_cents integer NOT NULL,
  net_amount_cents integer NOT NULL,
  stripe_payment_intent_id text,
  paid_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.sessions (
  id text NOT NULL,
  user_id text NOT NULL,
  token text NOT NULL,
  expires_at timestamp(3) without time zone NOT NULL,
  ip_address text,
  user_agent text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.shortlist_items (
  id text NOT NULL,
  shortlist_id text NOT NULL,
  inventory_item_id text NOT NULL,
  added_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  readiness_state text DEFAULT 'AUCTION_READY'::text NOT NULL
);
CREATE TABLE public.shortlists (
  id text NOT NULL,
  buyer_id text NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.sla_violations (
  id text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  sla_type text NOT NULL,
  breached_at timestamp(3) without time zone NOT NULL,
  hours_overdue double precision NOT NULL,
  resolved boolean DEFAULT false NOT NULL,
  resolved_at timestamp(3) without time zone
);
CREATE TABLE public.sms_opt_outs (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  phone text NOT NULL,
  reason text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.sms_suppression (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  phone text NOT NULL,
  reason text NOT NULL,
  contact_id uuid,
  restarted_at timestamp with time zone,
  suppressed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.social_intelligence_cache (
  id text NOT NULL,
  cache_key text NOT NULL,
  data jsonb NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.social_leads (
  id text NOT NULL,
  social_post_id text,
  platform text,
  franchise text,
  utm_source text,
  utm_campaign text,
  utm_content text,
  utm_hook text,
  landing_page text,
  first_name text NOT NULL,
  last_name text,
  email text NOT NULL,
  phone text,
  zip text,
  city text,
  state text,
  vehicle_interest text,
  make text,
  model text,
  budget text,
  timeline text,
  buyer_opp_id text,
  vehicle_request_id text,
  status text DEFAULT 'NEW'::text NOT NULL,
  nurture_sequence text,
  nurture_step integer DEFAULT 0 NOT NULL,
  last_email_sent_at timestamp with time zone,
  converted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.social_performance (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  post_id text NOT NULL,
  impressions integer DEFAULT 0 NOT NULL,
  reach integer DEFAULT 0 NOT NULL,
  views integer DEFAULT 0 NOT NULL,
  watch_time_pct double precision,
  completion_rate double precision,
  likes integer DEFAULT 0 NOT NULL,
  comments integer DEFAULT 0 NOT NULL,
  shares integer DEFAULT 0 NOT NULL,
  saves integer DEFAULT 0 NOT NULL,
  link_clicks integer DEFAULT 0 NOT NULL,
  profile_visits integer DEFAULT 0 NOT NULL,
  vehicle_requests integer DEFAULT 0 NOT NULL,
  dealer_signups integer DEFAULT 0 NOT NULL,
  dealer_bids integer DEFAULT 0 NOT NULL,
  deals_won integer DEFAULT 0 NOT NULL,
  revenue_generated integer DEFAULT 0 NOT NULL,
  lead_score integer DEFAULT 0 NOT NULL,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.social_posts (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  franchise_id text,
  signal_id text,
  source_article_id text,
  source_vehicle_request_id text,
  platform text NOT NULL,
  content_type text NOT NULL,
  hook_type text,
  hook text NOT NULL,
  script text NOT NULL,
  caption text NOT NULL,
  hashtags text[] DEFAULT '{}'::text[] NOT NULL,
  cta_text text,
  cta_placement text,
  visual_prompt text,
  visual_style text,
  voiceover_text text,
  on_screen_text text,
  duration_seconds integer,
  geo_target text,
  make text,
  model text,
  metro text,
  state text,
  funnel_destination text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  utm_hook text,
  utm_platform text,
  tracked_url text,
  compliance_notes text,
  requires_review boolean DEFAULT false NOT NULL,
  automation_mode text DEFAULT 'HYBRID_AUTO'::text NOT NULL,
  status "SocialPostStatus" DEFAULT 'DRAFT'::"SocialPostStatus" NOT NULL,
  rejection_reason text,
  scheduled_at timestamp with time zone,
  published_at timestamp with time zone,
  publishing_provider text,
  platform_post_id text,
  publish_error text,
  publish_attempts integer DEFAULT 0 NOT NULL,
  lead_score integer DEFAULT 0 NOT NULL,
  creator_id text,
  affiliate_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.social_videos (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  post_id text NOT NULL,
  provider text DEFAULT 'higgsfield'::text NOT NULL,
  provider_job_id text,
  status "SocialVideoStatus" DEFAULT 'SCRIPT_READY'::"SocialVideoStatus" NOT NULL,
  visual_prompt text,
  duration_seconds integer,
  style text,
  video_url text,
  thumbnail_url text,
  file_size integer,
  duration_actual double precision,
  last_polled_at timestamp with time zone,
  poll_attempts integer DEFAULT 0 NOT NULL,
  error_message text,
  retry_count integer DEFAULT 0 NOT NULL,
  storage_path text,
  storage_bucket text,
  generated_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.system_config_history (
  id text NOT NULL,
  config_key text NOT NULL,
  old_value jsonb,
  new_value jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
