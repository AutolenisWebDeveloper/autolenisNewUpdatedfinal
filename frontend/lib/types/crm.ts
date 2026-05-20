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
