CREATE TABLE public.content_article_versions (
  id text NOT NULL,
  article_id text NOT NULL,
  version_number integer NOT NULL,
  title text NOT NULL,
  h1 text NOT NULL,
  meta_description text NOT NULL,
  body text NOT NULL,
  faq_json text,
  quality_score integer,
  compliance_result_json text,
  generated_by_model text,
  created_by_admin_id text,
  created_by_job_id text,
  change_reason text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.content_articles (
  id text NOT NULL,
  slug text NOT NULL,
  cluster text NOT NULL,
  make text,
  model text,
  city text NOT NULL,
  state text NOT NULL,
  metro text,
  wave integer DEFAULT 1 NOT NULL,
  target_keyword text NOT NULL,
  title text NOT NULL,
  meta_description text NOT NULL,
  h1 text NOT NULL,
  body text,
  faq_json text,
  word_count integer,
  author_slug text DEFAULT 'markist'::text NOT NULL,
  status "ArticleStatus" DEFAULT 'DRAFT'::"ArticleStatus" NOT NULL,
  quality_score integer,
  quality_flags text,
  published_at timestamp(3) without time zone,
  generated_at timestamp(3) without time zone,
  groq_model text,
  search_grounded boolean,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  scheduled_at timestamp(3) without time zone,
  approved_at timestamp(3) without time zone,
  approved_by_admin_id text,
  last_published_at timestamp(3) without time zone,
  publish_failure_reason text,
  publication_version integer DEFAULT 1 NOT NULL,
  canonical_url text,
  noindex boolean DEFAULT false NOT NULL,
  featured_image_url text,
  featured_image_alt text,
  featured_image_status text,
  featured_image_prompt text,
  featured_image_provider text,
  featured_image_generated_at timestamp(3) without time zone,
  lifecycle_status text DEFAULT 'ACTIVE'::text NOT NULL,
  refresh_due_at timestamp(3) without time zone,
  last_validated_at timestamp(3) without time zone,
  last_refreshed_at timestamp(3) without time zone
);
CREATE TABLE public.content_attributions (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  article_slug text NOT NULL,
  cluster text NOT NULL,
  city text NOT NULL,
  state text NOT NULL,
  metro text,
  source text NOT NULL,
  buyer_opportunity_id text,
  email text,
  lead_temperature text,
  converted boolean DEFAULT false NOT NULL,
  converted_at timestamp with time zone,
  conversion_value_cents integer,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.content_derivatives (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  signal_id text,
  source_article_id text,
  post_id text NOT NULL,
  platform text NOT NULL,
  derivative_type text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.content_franchises (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  platforms text[] DEFAULT '{}'::text[] NOT NULL,
  cadence text DEFAULT 'daily'::text NOT NULL,
  posting_slots integer[] DEFAULT '{7,12,19}'::integer[] NOT NULL,
  hook_types text[] DEFAULT '{}'::text[] NOT NULL,
  requires_review boolean DEFAULT false NOT NULL,
  active boolean DEFAULT true NOT NULL,
  avg_lead_score double precision,
  posts_generated integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.content_generation_job_items (
  id text NOT NULL,
  job_id text NOT NULL,
  status "ContentJobStatus" DEFAULT 'QUEUED'::"ContentJobStatus" NOT NULL,
  attempt_count integer DEFAULT 0 NOT NULL,
  last_error text,
  idempotency_key text NOT NULL,
  inngest_run_id text,
  article_id text,
  target_slug text,
  payload_json text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.content_generation_jobs (
  id text NOT NULL,
  status "ContentJobStatus" DEFAULT 'QUEUED'::"ContentJobStatus" NOT NULL,
  job_type text NOT NULL,
  total_items integer DEFAULT 0 NOT NULL,
  succeeded_items integer DEFAULT 0 NOT NULL,
  failed_items integer DEFAULT 0 NOT NULL,
  created_by_admin_id text,
  filter_json text,
  last_error text,
  started_at timestamp(3) without time zone,
  completed_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.content_media_assets (
  id text NOT NULL,
  article_id text NOT NULL,
  url text NOT NULL,
  alt text,
  provider text,
  status text DEFAULT 'PENDING'::text NOT NULL,
  width integer,
  height integer,
  bytes integer,
  prompt text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.content_queue (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  priority_score double precision NOT NULL,
  content_tier text NOT NULL,
  make text,
  model text,
  metro text,
  state text,
  intent_template text NOT NULL,
  keyword_target text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  failure_reason text,
  scheduled_date timestamp with time zone,
  content_page_id text,
  attempts integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.content_validation_results (
  id text NOT NULL,
  article_id text NOT NULL,
  check_results_json text NOT NULL,
  passed boolean DEFAULT false NOT NULL,
  overridden_by_admin_id text,
  override_reason text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.content_workflow_events (
  id text NOT NULL,
  article_id text,
  job_id text,
  event_type text NOT NULL,
  actor text NOT NULL,
  payload_json text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.contract_scan_history (
  id text NOT NULL,
  deal_id text NOT NULL,
  version integer NOT NULL,
  score integer NOT NULL,
  status text NOT NULL,
  scan_run_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  triggered_by text
);
CREATE TABLE public.contract_scan_rule_history (
  id text NOT NULL,
  rule_id text NOT NULL,
  field text NOT NULL,
  old_value jsonb NOT NULL,
  new_value jsonb NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.contract_scan_rules (
  id text NOT NULL,
  name text NOT NULL,
  description text,
  rule_type text NOT NULL,
  severity text NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  config jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.contract_scans (
  id text NOT NULL,
  deal_id text NOT NULL,
  score integer NOT NULL,
  status text NOT NULL,
  fix_list jsonb DEFAULT '[]'::jsonb NOT NULL,
  change_log jsonb,
  version integer DEFAULT 1 NOT NULL,
  scanned_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  contract_version_id text
);
CREATE TABLE public.contract_versions (
  id text NOT NULL,
  deal_id text NOT NULL,
  document_url text NOT NULL,
  version integer DEFAULT 1 NOT NULL,
  uploaded_by text NOT NULL,
  status "ContractVersionStatus" DEFAULT 'UPLOADED'::"ContractVersionStatus" NOT NULL,
  scan_run_at timestamp(3) without time zone,
  approved_at timestamp(3) without time zone,
  rejected_at timestamp(3) without time zone,
  rejection_reason text,
  uploaded_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.conversation_messages (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conversation_id uuid NOT NULL,
  direction text NOT NULL,
  sender_type text,
  sender_id uuid,
  body text NOT NULL,
  twilio_sid text,
  resend_id text,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.conversations (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  contact_id uuid NOT NULL,
  phone text,
  channel text DEFAULT 'sms'::text NOT NULL,
  assigned_to uuid,
  unread_count integer DEFAULT 0 NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  last_message_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.creator_attributions (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  creator_id text NOT NULL,
  post_id text NOT NULL,
  platform text NOT NULL,
  platform_post_id text,
  tracking_code text,
  tracked_url text,
  clicks integer DEFAULT 0 NOT NULL,
  vehicle_requests integer DEFAULT 0 NOT NULL,
  dealer_signups integer DEFAULT 0 NOT NULL,
  deals_won integer DEFAULT 0 NOT NULL,
  revenue_generated integer DEFAULT 0 NOT NULL,
  commission_earned integer DEFAULT 0 NOT NULL,
  published_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.creator_network (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  affiliate_id text,
  name text NOT NULL,
  email text,
  platform text NOT NULL,
  platforms text[] DEFAULT '{}'::text[] NOT NULL,
  handle text,
  follower_count integer,
  engagement_rate double precision,
  niche text,
  city text,
  state text,
  commission_rate double precision,
  status text DEFAULT 'PENDING'::text NOT NULL,
  total_posts integer DEFAULT 0 NOT NULL,
  total_clicks integer DEFAULT 0 NOT NULL,
  total_requests integer DEFAULT 0 NOT NULL,
  total_revenue integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE public.credit_applications (
  id text NOT NULL,
  deal_id text NOT NULL,
  buyer_id text NOT NULL,
  status "CreditApplicationStatus" DEFAULT 'DRAFT'::"CreditApplicationStatus" NOT NULL,
  financing_path "FinancingPath" DEFAULT 'DEALER'::"FinancingPath" NOT NULL,
  amount_requested_cents integer,
  term_months integer,
  ssn_encrypted text,
  annual_income_encrypted text,
  employment_encrypted text,
  dob_encrypted text,
  lender_name text,
  lender_reference_id text,
  decision_outcome text,
  approved_amount_cents integer,
  apr_rate double precision,
  monthly_payment_cents integer,
  stipulations jsonb,
  decline_reason_codes jsonb,
  submitted_at timestamp(3) without time zone,
  decided_at timestamp(3) without time zone,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.crm_tasks (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  title text NOT NULL,
  description text,
  priority text DEFAULT 'medium'::text NOT NULL,
  status text DEFAULT 'open'::text NOT NULL,
  contact_id uuid,
  scope text DEFAULT 'contact'::text NOT NULL,
  assigned_to uuid,
  due_at timestamp with time zone,
  source text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  workflow_enrollment_id uuid
);
CREATE TABLE public.cron_job_logs (
  id text NOT NULL,
  cron_name text NOT NULL,
  status "CronJobStatus" NOT NULL,
  duration integer,
  result jsonb,
  error text,
  started_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  completed_at timestamp(3) without time zone
);
CREATE TABLE public.csrf_tokens (
  id text NOT NULL,
  token text NOT NULL,
  user_id text,
  expires_at timestamp(3) without time zone NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.deal_notes (
  id text NOT NULL,
  deal_id text NOT NULL,
  admin_id text NOT NULL,
  admin_email text NOT NULL,
  content text NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.deal_status_history (
  id text NOT NULL,
  deal_id text NOT NULL,
  from_status text NOT NULL,
  to_status text NOT NULL,
  actor_id text,
  actor_role text,
  reason text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.deal_timeline (
  id text NOT NULL,
  deal_id text NOT NULL,
  stage text NOT NULL,
  title text NOT NULL,
  description text,
  actor_id text,
  actor_role text,
  occurred_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.dealer_account_claim_tokens (
  id text NOT NULL,
  token_hash text NOT NULL,
  dealer_id text NOT NULL,
  application_id text,
  expires_at timestamp(3) without time zone NOT NULL,
  consumed_at timestamp(3) without time zone,
  created_by_admin_id text NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.dealer_agreement_signatures (
  id text NOT NULL,
  dealer_id text NOT NULL,
  agreement_version text NOT NULL,
  agreement_hash text NOT NULL,
  signer_name text NOT NULL,
  signer_email text NOT NULL,
  dealership_name text NOT NULL,
  ip_address text NOT NULL,
  user_agent text NOT NULL,
  signed_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  consented_to_electronic boolean DEFAULT true NOT NULL,
  certificate_pdf_path text,
  certificate_generated_at timestamp(3) without time zone,
  confirmation_email_sent_at timestamp(3) without time zone,
  confirmation_email_id text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.dealer_applications (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  dealership_name text NOT NULL,
  dealership_type text NOT NULL,
  state text NOT NULL,
  city text NOT NULL,
  zip text NOT NULL,
  license_number text NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text,
  annual_volume text,
  notes text,
  status "DealerApplicationStatus" DEFAULT 'PENDING'::"DealerApplicationStatus" NOT NULL,
  reviewed_by text,
  reviewed_at timestamp(3) without time zone,
  reject_reason text,
  dealer_id text,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE TABLE public.dealer_availability (
  id text NOT NULL,
  dealer_id text NOT NULL,
  timezone text NOT NULL,
  timezone_overridden boolean DEFAULT false NOT NULL,
  min_lead_time_hours integer DEFAULT 24 NOT NULL,
  max_advance_days integer DEFAULT 30 NOT NULL,
  created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at timestamp(3) without time zone NOT NULL
);
CREATE TABLE public.dealer_availability_windows (
  id text NOT NULL,
  availability_id text NOT NULL,
  weekday integer NOT NULL,
  open_minute integer NOT NULL,
  close_minute integer NOT NULL
);
CREATE TABLE public.dealer_blackout_dates (
  id text NOT NULL,
  availability_id text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text
);
