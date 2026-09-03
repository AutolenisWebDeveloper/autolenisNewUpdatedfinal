CREATE TABLE public.system_configurations (
  id text NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL,
  description text,
  updated_by text,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.testimonials (
  id text NOT NULL,
  buyer_id text NOT NULL,
  deal_id text NOT NULL,
  rating integer NOT NULL,
  text text NOT NULL,
  is_approved boolean DEFAULT false NOT NULL,
  is_published boolean DEFAULT false NOT NULL,
  reviewed_at timestamp(3) without time zone,
  reviewed_by text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.topic_signals (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  signal_type text NOT NULL,
  make text,
  model text,
  city text,
  metro text,
  state text,
  signal_value double precision,
  signal_delta double precision,
  signal_context jsonb DEFAULT '{}'::jsonb NOT NULL,
  source_table text,
  source_id text,
  assets_generated boolean DEFAULT false NOT NULL,
  asset_count integer DEFAULT 0 NOT NULL,
  detected_at timestamp with time zone DEFAULT now() NOT NULL,
  expires_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.trade_in_submissions (
  id text NOT NULL,
  buyer_id text NOT NULL,
  vin text,
  year integer NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  "trim" text,
  mileage integer,
  condition "TradeInCondition" NOT NULL,
  loan_status text,
  loan_balance_cents integer,
  notes text,
  status "TradeInStatus" DEFAULT 'SUBMITTED'::"TradeInStatus" NOT NULL,
  valuation_cents integer,
  valued_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.trade_in_valuations (
  id text NOT NULL,
  trade_in_id text NOT NULL,
  market_value_cents integer,
  trade_value_cents integer,
  valuation_source text,
  valued_at timestamp(3) without time zone,
  notes text
);
CREATE TABLE public.user_preferences (
  id text NOT NULL,
  user_id text NOT NULL,
  theme text DEFAULT 'light'::text NOT NULL,
  language text DEFAULT 'en'::text NOT NULL,
  timezone text DEFAULT 'America/New_York'::text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.users (
  id text NOT NULL,
  supabase_id text NOT NULL,
  email text NOT NULL,
  role "UserRole" NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  requires_password_change boolean DEFAULT false NOT NULL
);
CREATE TABLE public.vehicle_comparisons_saved (
  id text NOT NULL,
  buyer_id text NOT NULL,
  vehicle_ids text[],
  name text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.vehicle_intelligence (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  "trim" text,
  year integer NOT NULL,
  msrp_cents integer NOT NULL,
  fair_market_low_cents integer NOT NULL,
  fair_market_high_cents integer NOT NULL,
  aggressive_target_cents integer NOT NULL,
  active_incentives text,
  incentives_expires_at timestamp with time zone,
  financing_notes text,
  lease_notes text,
  negotiation_difficulty text NOT NULL,
  data_source text NOT NULL,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.vehicle_match_scores (
  id text NOT NULL,
  buyer_id text NOT NULL,
  inventory_item_id text NOT NULL,
  score double precision NOT NULL,
  factors jsonb NOT NULL,
  calculated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.vehicle_offer_dealer_invites (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  vehicle_offer_id text NOT NULL,
  token text DEFAULT (gen_random_uuid())::text NOT NULL,
  dealership_name text NOT NULL,
  contact_name text,
  dealer_email text NOT NULL,
  dealer_phone text,
  status text DEFAULT 'sent'::text NOT NULL,
  sent_at timestamp without time zone DEFAULT now() NOT NULL,
  opened_at timestamp without time zone,
  submitted_at timestamp without time zone,
  expires_at timestamp without time zone,
  submission_id text
);
CREATE TABLE public.vehicle_offers (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  token text DEFAULT (gen_random_uuid())::text NOT NULL,
  vehicle_year integer NOT NULL,
  vehicle_make text NOT NULL,
  vehicle_model text NOT NULL,
  vehicle_trim text,
  vehicle_mileage integer,
  vehicle_vin text,
  vehicle_color text,
  vehicle_condition text NOT NULL,
  asking_price_cents integer,
  vehicle_reference_url text,
  buyer_budget text NOT NULL,
  buyer_zip text NOT NULL,
  buyer_new_or_used text NOT NULL,
  buyer_financing text NOT NULL,
  buyer_email text,
  buyer_name text,
  admin_notes text,
  reference_id text,
  expires_at timestamp without time zone,
  created_by_admin_id text NOT NULL,
  created_at timestamp without time zone DEFAULT now() NOT NULL,
  vehicle_interior_color text,
  buyer_phone text,
  buyer_city text,
  buyer_state text,
  buyer_monthly_payment text,
  buyer_down_payment text,
  buyer_timeline text,
  buyer_open_to_alt boolean DEFAULT false,
  buyer_must_have text,
  buyer_drivetrain text,
  buyer_fuel_type text,
  buyer_max_mileage text,
  buyer_seating text,
  buyer_interior_color text,
  buyer_has_trade_in boolean DEFAULT false,
  buyer_trade_year text,
  buyer_trade_make text,
  buyer_trade_model text,
  buyer_trade_mileage text,
  buyer_trade_payoff text,
  buyer_trade_condition text,
  buyer_trade_vin text,
  buyer_trade_accident text,
  request_status text DEFAULT 'new'::text
);
CREATE TABLE public.vehicle_request_buyer_updates (
  id text NOT NULL,
  request_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  is_read boolean DEFAULT false NOT NULL,
  admin_id text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.vehicle_request_due_diligence_checkpoints (
  id text NOT NULL,
  request_id text NOT NULL,
  name text NOT NULL,
  description text,
  completed boolean DEFAULT false NOT NULL,
  completed_at timestamp(3) without time zone,
  completed_by text,
  "order" integer DEFAULT 0 NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.vehicle_request_events (
  id text NOT NULL,
  request_id text NOT NULL,
  event_type text NOT NULL,
  actor_id text,
  actor_role text,
  payload jsonb,
  note text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.vehicle_request_financing (
  id text NOT NULL,
  vehicle_request_id text NOT NULL,
  payment_method text,
  pre_approval_status text,
  lender_name text,
  approved_amount_cents integer,
  quoted_apr numeric(5,3),
  approval_expires_at timestamp(3) without time zone,
  down_payment_cents integer,
  monthly_payment_target_cents integer,
  pre_approval_letter_url text,
  estimated_credit_range text,
  estimated_annual_income_cents integer,
  proof_of_funds_available boolean,
  max_budget_cents integer,
  lease_term_months integer,
  lease_miles_per_year integer,
  trade_in boolean,
  purchase_timeframe text,
  lead_quality_score integer,
  admin_badge text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.vehicle_request_match_results (
  id text NOT NULL,
  request_id text NOT NULL,
  inventory_item_id text,
  match_score double precision,
  source text NOT NULL,
  price_cents integer,
  notes text,
  found_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.vehicle_request_offers (
  id text NOT NULL,
  request_id text NOT NULL,
  status text DEFAULT 'DRAFT'::text NOT NULL,
  vehicle_info jsonb NOT NULL,
  price_cents integer NOT NULL,
  notes text,
  sent_at timestamp(3) without time zone,
  responded_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.vehicle_request_research_logs (
  id text NOT NULL,
  request_id text NOT NULL,
  admin_id text NOT NULL,
  notes text NOT NULL,
  source_url text,
  metadata jsonb,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.vehicle_requests (
  id text NOT NULL,
  buyer_id text NOT NULL,
  status "VehicleRequestStatus" DEFAULT 'SUBMITTED'::"VehicleRequestStatus" NOT NULL,
  make_preference text,
  model_preference text,
  year_min integer,
  year_max integer,
  max_budget_cents integer,
  notes text,
  assigned_admin_id text,
  cancelled_at timestamp(3) without time zone,
  cancel_reason text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  financing_preference text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  source_url text,
  ip_address text,
  buyer_opportunity_id text,
  landing_source text,
  referrer text,
  coverage_hold_at timestamp(3) without time zone,
  coverage_hold_reason text
);
CREATE TABLE public.verse_library (
  id text NOT NULL,
  reference text NOT NULL,
  text text NOT NULL,
  book text NOT NULL,
  chapter integer NOT NULL,
  verse integer NOT NULL,
  translation text DEFAULT 'NKJV'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.verse_page_assignments (
  id text NOT NULL,
  page_key text NOT NULL,
  verse_id text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  is_override boolean DEFAULT false NOT NULL,
  effective_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  expires_at timestamp(3) without time zone,
  rotation_week integer NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.violation_pattern_records (
  id text NOT NULL,
  dealer_id text NOT NULL,
  rule_id text NOT NULL,
  count integer DEFAULT 1 NOT NULL,
  flagged boolean DEFAULT false NOT NULL,
  first_seen timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  last_seen timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.webhook_events (
  id text NOT NULL,
  source text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean DEFAULT false NOT NULL,
  error text,
  received_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.winning_patterns (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  platform text NOT NULL,
  franchise_slug text,
  hook_type text,
  content_type text,
  geo_target text,
  make text,
  day_of_week integer,
  hour integer,
  avg_ctr double precision,
  avg_engagement double precision,
  avg_lead_score double precision,
  avg_vehicle_requests double precision,
  avg_revenue double precision,
  sample_size integer DEFAULT 0 NOT NULL,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  avg_completion_rate double precision
);
CREATE TABLE public.workflow_enrollments (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workflow_id uuid NOT NULL,
  contact_id uuid NOT NULL,
  status text DEFAULT 'active'::text NOT NULL,
  current_node_id text,
  trigger_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  enrolled_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  exited_at timestamp with time zone,
  exit_reason text,
  resume_at timestamp with time zone,
  resume_node_id text
);
CREATE TABLE public.workflow_execution_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  enrollment_id uuid NOT NULL,
  node_id text NOT NULL,
  node_type text NOT NULL,
  status text NOT NULL,
  input_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  output_data jsonb DEFAULT '{}'::jsonb NOT NULL,
  error_message text,
  executed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.workflow_versions (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workflow_id uuid NOT NULL,
  version integer NOT NULL,
  nodes jsonb NOT NULL,
  trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.workflows (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  name text NOT NULL,
  description text,
  status text DEFAULT 'draft'::text NOT NULL,
  trigger_type text NOT NULL,
  trigger_config jsonb DEFAULT '{}'::jsonb NOT NULL,
  nodes jsonb DEFAULT '{"edges": [], "nodes": []}'::jsonb NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  is_prebuilt boolean DEFAULT false NOT NULL,
  prebuilt_key text,
  created_by uuid,
  activated_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
