CREATE TABLE public.ai_action_intents (
  id text NOT NULL,
  intent_type text NOT NULL,
  status "AiActionIntentStatus" DEFAULT 'PROPOSED'::"AiActionIntentStatus" NOT NULL,
  actor_type text NOT NULL,
  actor_id text NOT NULL,
  authenticated_role text NOT NULL,
  subject_id text,
  parameters jsonb NOT NULL,
  consequence text NOT NULL,
  requires_human_approval boolean NOT NULL,
  idempotency_key text,
  rationale text,
  policy_result jsonb,
  approver_id text,
  approver_role text,
  approved_at timestamp(3) without time zone,
  rejected_at timestamp(3) without time zone,
  rejection_code text,
  execution_claimed_at timestamp(3) without time zone,
  execution_attempts integer DEFAULT 0 NOT NULL,
  result jsonb,
  failure_reason text,
  completed_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.ai_chat_messages (
  id text NOT NULL,
  session_id text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  model text,
  sent_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.ai_chat_sessions (
  id text NOT NULL,
  buyer_id text NOT NULL,
  agent_type text DEFAULT 'general'::text NOT NULL,
  started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  ended_at timestamp(3) without time zone,
  message_count integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.ai_context_cache (
  id text NOT NULL,
  buyer_id text NOT NULL,
  summary text,
  "keyFacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  concerns jsonb DEFAULT '[]'::jsonb NOT NULL,
  last_updated timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.ai_conversation_contexts (
  id text NOT NULL,
  buyer_id text NOT NULL,
  last_summary text,
  concerns jsonb DEFAULT '[]'::jsonb NOT NULL,
  preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
  last_session_at timestamp(3) without time zone,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.ai_kill_switch_logs (
  id text NOT NULL,
  enabled boolean NOT NULL,
  reason text,
  admin_id text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.ai_media_generations (
  id text NOT NULL,
  provider text DEFAULT 'higgsfield'::text NOT NULL,
  endpoint text NOT NULL,
  generation_type text NOT NULL,
  prompt text NOT NULL,
  input_images jsonb,
  input_audio jsonb,
  input_payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  higgsfield_request_id text,
  status text DEFAULT 'queued'::text NOT NULL,
  status_url text,
  cancel_url text,
  output_images jsonb,
  output_video_url text,
  output_raw jsonb,
  error_message text,
  nsfw_flagged boolean DEFAULT false NOT NULL,
  created_by_id text,
  vehicle_id text,
  article_id text,
  social_post_id text,
  campaign_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);
CREATE TABLE public.amips_intelligence_snapshots (
  id text NOT NULL,
  captured_at timestamp(3) without time zone DEFAULT now() NOT NULL,
  health_score integer NOT NULL,
  metros_covered integer NOT NULL,
  metros_scored integer NOT NULL,
  avg_buyer_leverage double precision NOT NULL,
  active_pages integer NOT NULL,
  published_30d integer NOT NULL,
  impressions integer DEFAULT 0 NOT NULL,
  clicks integer DEFAULT 0 NOT NULL,
  leads integer DEFAULT 0 NOT NULL,
  revenue_run_rate_cents integer DEFAULT 0 NOT NULL,
  indexation_rate double precision DEFAULT 0 NOT NULL,
  payload_json text NOT NULL,
  created_at timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.amips_market_scores (
  id text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  metro text NOT NULL,
  state text NOT NULL,
  dealer_count integer DEFAULT 0 NOT NULL,
  overall_buyer_advantage double precision NOT NULL,
  score_json text NOT NULL,
  computed_at timestamp(3) without time zone DEFAULT now() NOT NULL,
  created_at timestamp(3) without time zone DEFAULT now() NOT NULL,
  updated_at timestamp(3) without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.amips_pages (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  slug text NOT NULL,
  content_tier text NOT NULL,
  make text,
  model text,
  metro text,
  state text,
  title text NOT NULL,
  meta_description text NOT NULL,
  h1 text NOT NULL,
  body text NOT NULL,
  faq_json text,
  market_score_json text,
  data_token_count integer DEFAULT 0 NOT NULL,
  cta_type text NOT NULL,
  lifecycle_status text DEFAULT 'ACTIVE'::text NOT NULL,
  quality_gate_status text NOT NULL,
  quality_gate_flags text,
  vehicle_data_as_of timestamp with time zone,
  dealer_data_as_of timestamp with time zone,
  market_data_as_of timestamp with time zone,
  published_at timestamp with time zone,
  last_refreshed_at timestamp with time zone,
  impressions integer DEFAULT 0 NOT NULL,
  clicks integer DEFAULT 0 NOT NULL,
  leads_generated integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.analytics_cohorts (
  id text NOT NULL,
  name text NOT NULL,
  definition jsonb NOT NULL,
  period text NOT NULL,
  size integer NOT NULL,
  metrics jsonb NOT NULL,
  computed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.apollo_credit_ledger (
  id text NOT NULL,
  cycle_key text NOT NULL,
  cap_credits integer NOT NULL,
  spent_credits integer DEFAULT 0 NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.apollo_enrichment_runs (
  id text NOT NULL,
  mode text NOT NULL,
  max_credits integer NOT NULL,
  candidate_count integer DEFAULT 0 NOT NULL,
  estimated_cost integer DEFAULT 0 NOT NULL,
  credits_spent integer DEFAULT 0 NOT NULL,
  enriched_count integer DEFAULT 0 NOT NULL,
  empty_count integer DEFAULT 0 NOT NULL,
  failed_count integer DEFAULT 0 NOT NULL,
  waterfall_enabled boolean DEFAULT false NOT NULL,
  status text DEFAULT 'RUNNING'::text NOT NULL,
  abort_reason text,
  started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  finished_at timestamp(3) without time zone,
  started_by text
);
CREATE TABLE public.apollo_person_candidates (
  id text NOT NULL,
  apollo_person_id text NOT NULL,
  apollo_organization_id text,
  first_name text,
  last_name_obfuscated text,
  title text,
  organization_name text,
  organization_city text,
  organization_state text,
  organization_zip text,
  organization_domain text,
  linkedin_url text,
  rooftop_id text,
  match_method text,
  match_confidence text,
  enrichment_status text DEFAULT 'NEW'::text NOT NULL,
  enrichment_error text,
  reveal_request_id text,
  reveal_poll_count integer DEFAULT 0 NOT NULL,
  last_synced_at timestamp(3) without time zone,
  search_run_key text NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.apollo_reveals (
  id text NOT NULL,
  rooftop_id text NOT NULL,
  cycle_key text NOT NULL,
  credits_cost integer DEFAULT 0 NOT NULL,
  consumer text DEFAULT 'live'::text NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  email text,
  email_status text,
  contact_name text,
  contact_title text,
  revealed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  empty_stage text
);
CREATE TABLE public.auction_extension_logs (
  id text NOT NULL,
  auction_id text NOT NULL,
  extended_by text NOT NULL,
  hours_added integer NOT NULL,
  original_end timestamp(3) without time zone NOT NULL,
  new_end timestamp(3) without time zone NOT NULL,
  reason text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  minutes_added integer,
  source "AuctionExtensionSource" DEFAULT 'MANUAL_ADMIN'::"AuctionExtensionSource" NOT NULL
);
CREATE TABLE public.auction_invitations (
  id text NOT NULL,
  auction_id text NOT NULL,
  dealer_id text NOT NULL,
  invitation_score double precision,
  sent_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  viewed_at timestamp(3) without time zone,
  responded_at timestamp(3) without time zone
);
CREATE TABLE public.auction_vehicles (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  auction_id text NOT NULL,
  inventory_item_id text,
  year integer,
  make text,
  model text,
  "trim" text,
  mileage integer,
  notes text,
  created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.auctions (
  id text NOT NULL,
  buyer_id text NOT NULL,
  deposit_id text NOT NULL,
  status "AuctionStatus" DEFAULT 'PENDING'::"AuctionStatus" NOT NULL,
  started_at timestamp(3) without time zone,
  ends_at timestamp(3) without time zone,
  closed_at timestamp(3) without time zone,
  extended_at timestamp(3) without time zone,
  extended_by text,
  extend_reason text,
  original_auction_id text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  reopened_at timestamp without time zone,
  post_close_processed_at timestamp(3) without time zone,
  auto_extension_count integer DEFAULT 0 NOT NULL,
  vehicle_request_id text
);
CREATE TABLE public.audit_logs (
  id text NOT NULL,
  admin_id text,
  user_id text,
  action "AdminActionType" NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text,
  ip_address text,
  metadata jsonb,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.autolenis_intelligence (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  metro text NOT NULL,
  vehicle_make text NOT NULL,
  vehicle_model text NOT NULL,
  request_volume integer DEFAULT 0 NOT NULL,
  dealer_response_rate double precision,
  avg_offers_received double precision,
  verified_savings_avg_cents integer,
  offer_win_rate double precision,
  transaction_count integer DEFAULT 0 NOT NULL,
  period_month text NOT NULL,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.best_price_calculation_logs (
  id text NOT NULL,
  auction_id text NOT NULL,
  term_months integer NOT NULL,
  offer_count integer NOT NULL,
  weights jsonb NOT NULL,
  result jsonb NOT NULL,
  calculated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.best_price_weight_configs (
  id text NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  weight_otd double precision DEFAULT 0.4 NOT NULL,
  weight_monthly double precision DEFAULT 0.25 NOT NULL,
  weight_fees double precision DEFAULT 0.2 NOT NULL,
  weight_junk_fees double precision DEFAULT 0.15 NOT NULL,
  created_by text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.best_price_weight_history (
  id text NOT NULL,
  config_id text NOT NULL,
  weights jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.buyer_activity_events (
  id text NOT NULL,
  buyer_id text NOT NULL,
  event_type text NOT NULL,
  title text NOT NULL,
  metadata jsonb,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.buyer_credit_history (
  id text NOT NULL,
  buyer_id text NOT NULL,
  prequal_id text NOT NULL,
  inquiry_type text DEFAULT 'SOFT_PULL'::text NOT NULL,
  provider text DEFAULT 'MicroBilt'::text NOT NULL,
  result_summary text,
  conducted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.buyer_inventory_preferences (
  id text NOT NULL,
  buyer_id text NOT NULL,
  preferred_makes text[],
  preferred_body_styles text[],
  max_mileage integer,
  min_year integer,
  features text[],
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.buyer_nudge_preferences (
  id text NOT NULL,
  buyer_id text NOT NULL,
  in_app_enabled boolean DEFAULT true NOT NULL,
  email_enabled boolean DEFAULT true NOT NULL,
  dismissed_stages text[],
  updated_at timestamp(3) without time zone NOT NULL
);
