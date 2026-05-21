// AutoLenis Phase 1 — CRM Type System
// Mirrors migrations/01_phase1_foundation.sql

export type ContactSource =
  | 'buyer_signup'
  | 'dealer_signup'
  | 'affiliate_signup'
  | 'public_form'
  | 'sms_inbound'
  | 'import';

export type LifecycleStage =
  | 'lead'
  | 'prequal_started'
  | 'prequal_completed'
  | 'deposit_pending'
  | 'deposit_paid'
  | 'auction_active'
  | 'offer_received'
  | 'purchase_completed'
  | 'inactive';

export interface Contact {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  source: ContactSource;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  source_url: string | null;
  ip_address: string | null;
  consent_sms: boolean;
  consent_email: boolean;
  consent_at: string | null;
  consent_ip: string | null;
  consent_text: string | null;
  lifecycle_stage: LifecycleStage;
  do_not_contact: boolean;
  tags: string[];
  notes: string | null;
  assigned_to: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactInput {
  email?: string | null;
  phone?: string | null;
  firstName?: string;
  lastName?: string;
  source: ContactSource;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  sourceUrl?: string;
  ipAddress?: string;
  consentSms?: boolean;
  consentEmail?: boolean;
  consentIp?: string;
  consentText?: string;
}

export type ContactUpdate = Partial<Omit<Contact, 'id' | 'created_at' | 'updated_at'>>;

export type ConversationChannel = 'sms' | 'email';
export type ConversationStatus = 'open' | 'assigned' | 'escalated' | 'resolved';

export interface Conversation {
  id: string;
  contact_id: string;
  phone: string | null;
  channel: ConversationChannel;
  assigned_to: string | null;
  unread_count: number;
  status: ConversationStatus;
  last_message_at: string;
  created_at: string;
  updated_at: string;
}

export type MessageDirection = 'inbound' | 'outbound' | 'internal';
export type SenderType = 'contact' | 'admin' | 'system';

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  direction: MessageDirection;
  sender_type: SenderType | null;
  sender_id: string | null;
  body: string;
  twilio_sid: string | null;
  resend_id: string | null;
  read_at: string | null;
  created_at: string;
}

export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'open' | 'in_progress' | 'completed' | 'deferred';
export type TaskScope = 'contact' | 'system' | 'admin';

export interface CRMTask {
  id: string;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  contact_id: string | null;
  scope: TaskScope;
  assigned_to: string | null;
  due_at: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
}

export type TimelineEventType =
  | 'email_sent' | 'email_opened' | 'email_clicked' | 'email_bounced' | 'email_unsubscribed'
  | 'sms_sent' | 'sms_delivered' | 'sms_failed' | 'sms_received' | 'sms_stopped'
  | 'call_logged' | 'note_added' | 'stage_changed' | 'task_created' | 'task_completed'
  | 'deposit_initiated' | 'deposit_paid' | 'deposit_refunded'
  | 'auction_started' | 'auction_closed'
  | 'offer_received' | 'offer_selected' | 'offer_expired'
  | 'contract_sent' | 'docusign_signed' | 'docusign_declined'
  | 'dealer_action' | 'affiliate_action'
  | 'admin_action' | 'automation_triggered' | 'automation_completed' | 'automation_exited'
  | 'campaign_sent' | 'campaign_opened' | 'campaign_clicked';

export interface TimelineEvent {
  id: string;
  contact_id: string;
  event_type: TimelineEventType;
  event_data: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export type EmailSuppressionReason =
  | 'unsubscribed' | 'bounced' | 'complained' | 'admin_added' | 'spam_trap';

export type SmsSuppressionReason =
  | 'stop' | 'admin_added' | 'invalid' | 'carrier_block';

// ----------------------------------------------------------------------------
// Phase 3 — Messaging, Campaigns, Segmentation
// Mirrors migrations/02_phase3_messaging.sql
// ----------------------------------------------------------------------------

export type EmailTemplateCategory = 'transactional' | 'marketing' | 'automation';
export type EmailTemplateStatus = 'active' | 'inactive' | 'draft';

// The 12 supported template variables. Keep in sync with TemplateService.SUPPORTED_VARIABLES.
export type TemplateVariable =
  | 'firstName' | 'lastName' | 'fullName'
  | 'vehicleMake' | 'vehicleModel' | 'vehicleYear'
  | 'dashboardUrl' | 'depositUrl' | 'auctionUrl' | 'offerUrl'
  | 'supportEmail' | 'unsubscribeUrl';

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  category: EmailTemplateCategory;
  html_body: string;
  text_body: string | null;
  variables: string[];
  thumbnail_url: string | null;
  status: EmailTemplateStatus;
  version: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailTemplateVersion {
  id: string;
  template_id: string;
  version: number;
  subject: string;
  html_body: string;
  text_body: string | null;
  created_by: string | null;
  created_at: string;
}

export interface EmailTemplateInput {
  name: string;
  subject: string;
  category?: EmailTemplateCategory;
  html_body: string;
  text_body?: string | null;
  variables?: string[];
  status?: EmailTemplateStatus;
}

export type EmailTemplateUpdate = Partial<EmailTemplateInput>;

export interface RenderedTemplate {
  subject: string;
  html: string;
  text: string;
}

// Segments — conditions JSONB structure validated at the service layer.
export type SegmentOperator =
  | 'eq' | 'neq'
  | 'contains' | 'not_contains'
  | 'gte' | 'lte'
  | 'is_true' | 'is_false'
  | 'before' | 'after';

export type SegmentField =
  | 'lifecycle_stage'
  | 'consent_sms'
  | 'consent_email'
  | 'do_not_contact'
  | 'source'
  | 'utm_source'
  | 'utm_campaign'
  | 'created_at';

export interface SegmentRule {
  field: SegmentField;
  op: SegmentOperator;
  value: string | number | boolean | null;
}

export interface SegmentConditions {
  match: 'all' | 'any';
  rules: SegmentRule[];
}

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  conditions: SegmentConditions;
  contact_count: number;
  last_counted_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

// Campaigns
export type CampaignType = 'email' | 'sms' | 'mixed';
export type CampaignStatus =
  | 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  segment_id: string | null;
  template_id: string | null;
  sms_body: string | null;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  recipient_count: number;
  sent_count: number;
  delivered_count: number;
  opened_count: number;
  clicked_count: number;
  bounced_count: number;
  failed_count: number;
  unsubscribed_count: number;
  suppressed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type CampaignRecipientStatus =
  | 'pending' | 'sent' | 'delivered' | 'opened' | 'clicked'
  | 'bounced' | 'failed' | 'unsubscribed' | 'suppressed';

export interface CampaignRecipient {
  id: string;
  campaign_id: string;
  contact_id: string;
  status: CampaignRecipientStatus;
  sent_at: string | null;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  unsubscribed_at: string | null;
  error_message: string | null;
  resend_id: string | null;
  twilio_sid: string | null;
  created_at: string;
}
