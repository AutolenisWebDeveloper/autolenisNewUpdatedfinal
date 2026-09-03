CREATE TABLE public.financing_scenarios (
  id text NOT NULL,
  buyer_id text NOT NULL,
  deal_id text,
  name text NOT NULL,
  vehicle_price_cents integer NOT NULL,
  down_payment_cents integer DEFAULT 0 NOT NULL,
  loan_amount_cents integer NOT NULL,
  apr_rate double precision NOT NULL,
  term_months integer NOT NULL,
  monthly_payment_cents integer NOT NULL,
  total_cost_cents integer NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.funnel_stage_snapshots (
  id text NOT NULL,
  snapshot_date timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  metric text NOT NULL,
  count integer NOT NULL,
  window_hours integer
);
CREATE TABLE public.health_check_logs (
  id text NOT NULL,
  status text NOT NULL,
  database boolean NOT NULL,
  inventory_health integer NOT NULL,
  active_auctions integer NOT NULL,
  pending_ofac integer NOT NULL,
  alerts jsonb DEFAULT '[]'::jsonb NOT NULL,
  checked_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.hook_performance (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  platform text NOT NULL,
  hook_type text NOT NULL,
  avg_completion_rate double precision,
  avg_ctr double precision,
  avg_lead_score double precision,
  avg_vehicle_requests double precision,
  sample_size integer DEFAULT 0 NOT NULL,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.hope_page_content (
  id text NOT NULL,
  section text NOT NULL,
  title text,
  body text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  "order" integer DEFAULT 0 NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.idempotency_keys (
  key_hash text NOT NULL,
  execution_status text NOT NULL,
  response_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.identity_firewall_entries (
  id text NOT NULL,
  buyer_id text,
  dealer_id text,
  flag "AntiCircumventionFlag" NOT NULL,
  description text NOT NULL,
  risk_score integer DEFAULT 0 NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.insurance_policies (
  id text NOT NULL,
  buyer_id text NOT NULL,
  deal_id text,
  status "InsurancePolicyStatus" DEFAULT 'ACTIVE'::"InsurancePolicyStatus" NOT NULL,
  policy_number text,
  provider_name text,
  proof_url text,
  effective_date timestamp(3) without time zone,
  expiry_date timestamp(3) without time zone,
  verified_at timestamp(3) without time zone,
  verified_by text,
  is_external boolean DEFAULT false NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.insurance_providers (
  id text NOT NULL,
  name text NOT NULL,
  api_key text,
  base_url text,
  is_active boolean DEFAULT true NOT NULL,
  is_mock_only boolean DEFAULT false NOT NULL,
  supported_states text[],
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.insurance_quotes (
  id text NOT NULL,
  buyer_id text NOT NULL,
  deal_id text,
  status "InsuranceQuoteStatus" DEFAULT 'PENDING'::"InsuranceQuoteStatus" NOT NULL,
  provider_name text,
  premium_cents integer,
  coverage_type text,
  deductible_cents integer,
  expires_at timestamp(3) without time zone,
  is_mock boolean DEFAULT false NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.inventory_feed_logs (
  id text NOT NULL,
  dealer_id text NOT NULL,
  feed_url text NOT NULL,
  status text NOT NULL,
  vehicles_processed integer DEFAULT 0 NOT NULL,
  vehicles_added integer DEFAULT 0 NOT NULL,
  vehicles_updated integer DEFAULT 0 NOT NULL,
  error text,
  started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  completed_at timestamp(3) without time zone
);
CREATE TABLE public.inventory_items (
  id text NOT NULL,
  dealer_id text,
  lane "InventoryLane" DEFAULT 'LANE_3'::"InventoryLane" NOT NULL,
  vin text,
  year integer NOT NULL,
  make text NOT NULL,
  model text NOT NULL,
  "trim" text,
  mileage integer,
  price_cents integer NOT NULL,
  description text,
  price_history jsonb DEFAULT '[]'::jsonb NOT NULL,
  external_listing_url text,
  external_dealer_name text,
  external_dealer_phone text,
  external_dealer_city text,
  external_dealer_state text,
  images text[],
  is_active boolean DEFAULT true NOT NULL,
  last_seen_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  source_adapter text,
  condition text,
  body_type text,
  exterior_color text,
  interior_color text,
  engine text,
  transmission text,
  drivetrain text,
  fuel_type text,
  city text,
  state text,
  zip text,
  added_by_admin_id text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  features text[] DEFAULT ARRAY[]::text[] NOT NULL,
  external_dealer_street text,
  external_dealer_zip text,
  external_dealer_email text,
  external_dealer_type text,
  mc_rooftop_id text,
  mc_dealer_id text,
  rooftop_id text
);
CREATE TABLE public.inventory_price_alerts (
  id text NOT NULL,
  buyer_id text NOT NULL,
  inventory_item_id text NOT NULL,
  target_price_cents integer NOT NULL,
  triggered boolean DEFAULT false NOT NULL,
  triggered_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.inventory_quality_scores (
  id text NOT NULL,
  inventory_item_id text NOT NULL,
  score integer NOT NULL,
  photo_score integer NOT NULL,
  data_score integer NOT NULL,
  vin_verified boolean DEFAULT false NOT NULL,
  price_score integer NOT NULL,
  computed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.inventory_sources (
  id text NOT NULL,
  type "InventorySourceType" NOT NULL,
  name text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  last_run_at timestamp(3) without time zone,
  last_run_status text,
  vehicles_last_count integer,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  center_zip text,
  radius_miles integer,
  filter_make text,
  filter_model text,
  filter_year_min integer,
  filter_year_max integer,
  filter_price_max_cents integer,
  rows_per_call integer DEFAULT 50 NOT NULL,
  max_calls_per_run integer DEFAULT 10 NOT NULL,
  monthly_call_budget integer,
  calls_used_this_cycle integer DEFAULT 0 NOT NULL,
  budget_cycle_key text
);
CREATE TABLE public.inventory_sync_runs (
  id text NOT NULL,
  source_id text NOT NULL,
  status "SyncRunStatus" NOT NULL,
  vehicles_fetched integer DEFAULT 0 NOT NULL,
  vehicles_upserted integer DEFAULT 0 NOT NULL,
  vehicles_deactivated integer DEFAULT 0 NOT NULL,
  health_score integer,
  error text,
  started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  completed_at timestamp(3) without time zone,
  api_calls_used integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.inventory_upload_batches (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  admin_id text NOT NULL,
  admin_email text NOT NULL,
  filename text,
  total_rows integer DEFAULT 0 NOT NULL,
  success_count integer DEFAULT 0 NOT NULL,
  failure_count integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'COMPLETED'::text NOT NULL,
  errors jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.jobs_dead_letter (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  job_id text NOT NULL,
  event_name text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb NOT NULL,
  error_message text NOT NULL,
  failed_at timestamp with time zone DEFAULT now() NOT NULL,
  auto_retry_count integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.junk_fee_patterns (
  id text NOT NULL,
  name text NOT NULL,
  keywords text[],
  severity text DEFAULT 'MEDIUM'::text NOT NULL,
  category text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.lead_nurture_schedule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  sequence text NOT NULL,
  step integer NOT NULL,
  contact_id text NOT NULL,
  contact_email text NOT NULL,
  first_name text,
  campaign text,
  idempotency_key text NOT NULL,
  run_at timestamp with time zone NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  claimed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.lead_nurtures (
  id text NOT NULL,
  lead_id text NOT NULL,
  sequence_type text NOT NULL,
  current_step integer DEFAULT 1,
  next_send_at timestamp(3) without time zone,
  completed_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE public.lead_scores (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  buyer_id text,
  session_id text,
  score integer NOT NULL,
  temperature text NOT NULL,
  signals jsonb NOT NULL,
  reasoning text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.lead_scoring_events (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contact_id uuid NOT NULL,
  action text NOT NULL,
  points integer NOT NULL,
  source text,
  idempotency_key text,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  occurred_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.lifecycle_touch_schedule (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  base_key text NOT NULL,
  sequence text NOT NULL,
  entity_id text NOT NULL,
  first_name text,
  email text NOT NULL,
  phone text,
  run_at timestamp with time zone NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  claimed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.market_coverage (
  id text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  zip text NOT NULL,
  status "MarketStatus" DEFAULT 'ACTIVE'::"MarketStatus" NOT NULL,
  listing_count integer DEFAULT 0 NOT NULL,
  last_sync_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.market_intelligence (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  metro_name text NOT NULL,
  state text NOT NULL,
  population integer,
  vehicle_demand_score double precision,
  competition_score double precision,
  inventory_score double precision,
  buyer_leverage_score double precision,
  seasonal_notes text,
  last_updated timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.marketplace_intelligence (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  vehicle_make text NOT NULL,
  vehicle_model text NOT NULL,
  vehicle_trim text,
  metro text NOT NULL,
  dealers_invited integer DEFAULT 0 NOT NULL,
  dealers_responded integer DEFAULT 0 NOT NULL,
  response_rate double precision,
  time_to_first_offer_minutes integer,
  time_to_final_offer_minutes integer,
  buyer_accepted_offer boolean,
  avg_offers_per_request double precision,
  lead_to_request_conversion double precision,
  request_to_deal_conversion double precision,
  transaction_date timestamp with time zone NOT NULL,
  buyer_opportunity_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.message_read_receipts (
  id text NOT NULL,
  message_id text NOT NULL,
  user_id text NOT NULL,
  read_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.message_thread_participants (
  id text NOT NULL,
  thread_id text NOT NULL,
  user_id text NOT NULL,
  role text NOT NULL,
  last_read_at timestamp(3) without time zone
);
CREATE TABLE public.message_threads (
  id text NOT NULL,
  deal_id text,
  request_id text,
  status "ThreadStatus" DEFAULT 'ACTIVE'::"ThreadStatus" NOT NULL,
  last_message_at timestamp(3) without time zone,
  flagged_at timestamp(3) without time zone,
  flag_reason text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.messages (
  id text NOT NULL,
  thread_id text NOT NULL,
  sender_id text NOT NULL,
  content text NOT NULL,
  status "MessageStatus" DEFAULT 'SENT'::"MessageStatus" NOT NULL,
  is_redacted boolean DEFAULT false NOT NULL,
  redact_reason text,
  anti_circumvention_flag "AntiCircumventionFlag",
  sent_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.notification_batches (
  id text NOT NULL,
  type text NOT NULL,
  count integer NOT NULL,
  sent_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  failed integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.notification_preferences (
  id text NOT NULL,
  user_id text NOT NULL,
  email_enabled boolean DEFAULT true NOT NULL,
  in_app_enabled boolean DEFAULT true NOT NULL,
  auction_updates boolean DEFAULT true NOT NULL,
  deal_updates boolean DEFAULT true NOT NULL,
  commission_updates boolean DEFAULT true NOT NULL,
  marketing_emails boolean DEFAULT false NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.notifications (
  id text NOT NULL,
  buyer_id text,
  dealer_id text,
  affiliate_id text,
  type "NotificationType" NOT NULL,
  channel "NotificationChannel" DEFAULT 'IN_APP'::"NotificationChannel" NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  action_url text,
  read_at timestamp(3) without time zone,
  metadata jsonb,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.nudge_configurations (
  id text NOT NULL,
  stage "NudgeStage" NOT NULL,
  in_app_delay_hours integer DEFAULT 4 NOT NULL,
  email_delay_hours integer DEFAULT 48 NOT NULL,
  max_dismissals integer DEFAULT 3 NOT NULL,
  cooldown_hours integer DEFAULT 48 NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.nudge_events (
  id text NOT NULL,
  buyer_id text NOT NULL,
  stage text NOT NULL,
  channel "NudgeChannel" NOT NULL,
  triggered_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  dismissed_at timestamp(3) without time zone,
  sent_at timestamp(3) without time zone
);
CREATE TABLE public.offers (
  id text NOT NULL,
  auction_id text NOT NULL,
  dealer_id text NOT NULL,
  status "OfferStatus" DEFAULT 'DRAFT'::"OfferStatus" NOT NULL,
  otd_price_cents integer NOT NULL,
  vehicle_price_cents integer NOT NULL,
  tax_cents integer DEFAULT 0 NOT NULL,
  fees_cents integer DEFAULT 0 NOT NULL,
  junk_fee_items jsonb DEFAULT '[]'::jsonb NOT NULL,
  includes_financing boolean DEFAULT false NOT NULL,
  apr_rate double precision,
  term_months integer,
  best_price_score double precision,
  rank_cash integer,
  rank_monthly integer,
  rank_balanced integer,
  apr_flag text,
  version integer DEFAULT 1 NOT NULL,
  original_offer_id text,
  submitted_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  external_dealer_name text,
  external_dealer_email text,
  external_dealer_phone text,
  notes text,
  submitted_by_admin_id text
);
CREATE TABLE public.outside_auction_invites (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  auction_id text NOT NULL,
  dealership_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text,
  token text DEFAULT (gen_random_uuid())::text NOT NULL,
  sent_at timestamp without time zone DEFAULT now() NOT NULL,
  viewed_at timestamp without time zone,
  responded_at timestamp without time zone,
  offer_id text,
  offer_otd_cents integer,
  offer_vehicle_cents integer,
  offer_tax_cents integer,
  offer_fees_cents integer,
  offer_notes text,
  rooftop_id text,
  expires_at timestamp(3) without time zone
);
CREATE TABLE public.payment_provider_events (
  id text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean DEFAULT false NOT NULL,
  processed_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.pickups (
  id text NOT NULL,
  deal_id text NOT NULL,
  status "PickupStatus" DEFAULT 'NOT_SCHEDULED'::"PickupStatus" NOT NULL,
  scheduled_at timestamp(3) without time zone,
  completed_at timestamp(3) without time zone,
  location text,
  qr_code_data text,
  qr_code_image text,
  qr_expires_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  proposed_time timestamp(3) without time zone,
  proposed_by text,
  proposed_at timestamp(3) without time zone,
  counter_count integer DEFAULT 0 NOT NULL,
  proposed_reminder_sent_at timestamp(3) without time zone,
  counter_reminder_sent_at timestamp(3) without time zone
);
