CREATE TABLE public._prisma_migrations (
  id character varying(36) NOT NULL,
  checksum character varying(64) NOT NULL,
  finished_at timestamp with time zone,
  migration_name character varying(255) NOT NULL,
  logs text,
  rolled_back_at timestamp with time zone,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  applied_steps_count integer DEFAULT 0 NOT NULL
);
CREATE TABLE public._prisma_migrations_backup_20260831 (
  id character varying(36),
  checksum character varying(64),
  finished_at timestamp with time zone,
  migration_name character varying(255),
  logs text,
  rolled_back_at timestamp with time zone,
  started_at timestamp with time zone,
  applied_steps_count integer
);
CREATE TABLE public.ab_test_groups (
  id text NOT NULL,
  name text NOT NULL,
  platform text NOT NULL,
  franchise_slug text NOT NULL,
  status text DEFAULT 'RUNNING'::text NOT NULL,
  winner_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);
CREATE TABLE public.ab_test_variants (
  id text NOT NULL,
  group_id text NOT NULL,
  post_id text NOT NULL,
  hook_type text NOT NULL,
  hook text NOT NULL,
  variant_label text NOT NULL,
  is_winner boolean DEFAULT false NOT NULL,
  score double precision DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.accepted_terms (
  id text NOT NULL,
  user_id text NOT NULL,
  terms_version text NOT NULL,
  accepted_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  ip_address text
);
CREATE TABLE public.acquisition_conversations (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  session_id text NOT NULL,
  buyer_id text,
  transcript jsonb DEFAULT '[]'::jsonb NOT NULL,
  completed boolean DEFAULT false NOT NULL,
  extracted_data jsonb,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.admin_audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  admin_id uuid NOT NULL,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  before_state jsonb,
  after_state jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.admin_audit_logs (
  id text NOT NULL,
  admin_id text NOT NULL,
  admin_email text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  reason text,
  metadata jsonb,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  previous_state jsonb,
  new_state jsonb,
  ip_address text,
  session_id text
);
CREATE TABLE public.admin_briefing_history (
  id text NOT NULL,
  period text NOT NULL,
  content text NOT NULL,
  delivered_to text[],
  model text DEFAULT 'llama-3.3-70b-versatile'::text NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.admin_briefings (
  id text NOT NULL,
  content text NOT NULL,
  period text NOT NULL,
  delivered_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.admin_impersonations (
  id text NOT NULL,
  admin_id text NOT NULL,
  target_user_id text NOT NULL,
  reason text NOT NULL,
  status "ImpersonationStatus" DEFAULT 'ACTIVE'::"ImpersonationStatus" NOT NULL,
  started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  ended_at timestamp(3) without time zone
);
CREATE TABLE public.admin_inventory_search_runs (
  id text NOT NULL,
  triggered_by text NOT NULL,
  params jsonb NOT NULL,
  status "CronJobStatus" DEFAULT 'RUNNING'::"CronJobStatus" NOT NULL,
  adapters_run integer DEFAULT 0 NOT NULL,
  vehicles_fetched integer DEFAULT 0 NOT NULL,
  vehicles_upserted integer DEFAULT 0 NOT NULL,
  health_score integer,
  started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  completed_at timestamp(3) without time zone,
  error text
);
CREATE TABLE public.admin_journey_notes (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  buyer_id text NOT NULL,
  stage_id text NOT NULL,
  content text NOT NULL,
  admin_id text NOT NULL,
  admin_email text NOT NULL,
  created_at timestamp without time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.admin_journey_unlocks (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  buyer_id text NOT NULL,
  stage_id text NOT NULL,
  admin_id text NOT NULL,
  admin_email text NOT NULL,
  note text,
  created_at timestamp without time zone DEFAULT now() NOT NULL,
  type text DEFAULT 'UNLOCK'::text NOT NULL
);
CREATE TABLE public.admin_login_logs (
  id text NOT NULL,
  admin_id text,
  email text NOT NULL,
  success boolean NOT NULL,
  ip_address text,
  fail_reason text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.admin_mfa_email_tokens (
  id text NOT NULL,
  admin_id text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamp(3) without time zone NOT NULL,
  used_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.admin_sessions (
  id text NOT NULL,
  admin_id text NOT NULL,
  token text NOT NULL,
  ip_address text,
  user_agent text,
  expires_at timestamp(3) without time zone NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.admin_support_notes (
  id text NOT NULL,
  admin_id text NOT NULL,
  target_user_id text NOT NULL,
  type "SupportNoteType" NOT NULL,
  content text NOT NULL,
  is_internal boolean DEFAULT true NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.admins (
  id text NOT NULL,
  user_id text NOT NULL,
  role "AdminRole" NOT NULL,
  totp_secret text,
  totp_enabled boolean DEFAULT false NOT NULL,
  recovery_codes text[],
  mfa_verified_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  password_hash text,
  last_recovery_code_used_at timestamp without time zone,
  pending_recovery_codes text[] DEFAULT ARRAY[]::text[] NOT NULL,
  mfa_failed_attempts integer DEFAULT 0 NOT NULL,
  mfa_locked_until timestamp(3) without time zone,
  mfa_reset_at timestamp(3) without time zone,
  "isActive" boolean DEFAULT true NOT NULL,
  deactivated_at timestamp(3) without time zone
);
CREATE TABLE public.affiliate_clicks (
  id text NOT NULL,
  affiliate_id text NOT NULL,
  clicked_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  ip_hash text,
  user_agent text,
  converted_at timestamp(3) without time zone,
  buyer_op_id text,
  referral_code text,
  referer text,
  landing_path text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  referred_user_id text
);
CREATE TABLE public.affiliate_compliance_records (
  id text NOT NULL,
  affiliate_id text NOT NULL,
  status "AffiliateComplianceStatus" DEFAULT 'PENDING_ACKNOWLEDGMENT'::"AffiliateComplianceStatus" NOT NULL,
  acknowledged_at timestamp(3) without time zone,
  disclosure_version text,
  violations jsonb DEFAULT '[]'::jsonb NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  ip_address text,
  user_agent text
);
CREATE TABLE public.affiliate_documents (
  id text NOT NULL,
  affiliate_id text NOT NULL,
  file_url text NOT NULL,
  file_name text NOT NULL,
  status text DEFAULT 'PENDING'::text NOT NULL,
  reviewed_at timestamp without time zone,
  reviewed_by text,
  rejection_reason text,
  created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  type text NOT NULL,
  file_size_bytes integer NOT NULL,
  uploaded_at timestamp without time zone DEFAULT now() NOT NULL,
  notes text
);
CREATE TABLE public.affiliate_onboarding_reviews (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  affiliate_id text NOT NULL,
  status "OnboardingStatus" DEFAULT 'NOT_STARTED'::"OnboardingStatus",
  current_step integer DEFAULT 1,
  submitted_at timestamp with time zone,
  reviewed_at timestamp with time zone,
  reviewed_by text,
  decision_note text,
  internal_notes text,
  correction_items text[],
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.affiliate_payment_profiles (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  affiliate_id text NOT NULL,
  payout_method text,
  holder_name text,
  routing_last4 text,
  account_last4 text,
  account_type text,
  paypal_email text,
  zelle_phone text,
  verified boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.affiliate_payout_methods (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  affiliate_id text NOT NULL,
  method text DEFAULT 'CHECK'::text NOT NULL,
  bank_name text,
  account_type text,
  routing_number_last4 text,
  account_number_last4 text,
  zelle_email text,
  paypal_email text,
  tax_id_last4 text,
  business_name text,
  tax_classification text,
  verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.affiliate_payout_schedules (
  id text NOT NULL,
  affiliate_id text NOT NULL,
  payout_day integer DEFAULT 1 NOT NULL,
  minimum_cents integer DEFAULT 2500 NOT NULL,
  method text DEFAULT 'BANK_TRANSFER'::text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.affiliate_payouts (
  id text NOT NULL,
  affiliate_id text NOT NULL,
  amount_cents integer NOT NULL,
  status "PayoutStatus" DEFAULT 'PENDING'::"PayoutStatus" NOT NULL,
  method text,
  reference text,
  period_start timestamp(3) without time zone NOT NULL,
  period_end timestamp(3) without time zone NOT NULL,
  requested_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  processed_at timestamp(3) without time zone,
  failure_reason text
);
CREATE TABLE public.affiliate_profiles (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  affiliate_id text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  date_of_birth text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  country text DEFAULT 'US'::text,
  entity_type text,
  business_name text,
  dba_name text,
  business_address text,
  ein_last4 text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.affiliate_referrals (
  id text NOT NULL,
  affiliate_id text NOT NULL,
  referred_user_id text NOT NULL,
  referral_code text NOT NULL,
  signed_up_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  first_deal_at timestamp(3) without time zone,
  total_deals integer DEFAULT 0 NOT NULL
);
CREATE TABLE public.affiliate_tax_profiles (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  affiliate_id text NOT NULL,
  tax_classification text,
  tin_last4 text,
  tin_type text,
  legal_name text,
  certified boolean DEFAULT false,
  certified_at timestamp with time zone,
  attestation_text text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now()
);
CREATE TABLE public.affiliate_tier_history (
  id text NOT NULL,
  affiliate_id text NOT NULL,
  "fromTier" "AffiliateTier" NOT NULL,
  "toTier" "AffiliateTier" NOT NULL,
  reason text,
  changed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.affiliates (
  id text NOT NULL,
  user_id text NOT NULL,
  referral_code text NOT NULL,
  status "AffiliateStatus" DEFAULT 'PENDING'::"AffiliateStatus" NOT NULL,
  parent_id text,
  level integer DEFAULT 1 NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL,
  promotion_method text,
  website text,
  ftc_acknowledged_at timestamp(3) without time zone,
  weekly_digest_enabled boolean DEFAULT true NOT NULL,
  last_digest_sent_at timestamp(3) without time zone,
  unsubscribe_token text,
  last_inactive_nudge_at timestamp(3) without time zone
);
