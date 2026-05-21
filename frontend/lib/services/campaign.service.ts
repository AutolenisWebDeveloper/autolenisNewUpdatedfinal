import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  Campaign,
  CampaignStatus,
  CampaignType,
} from '../types/crm';
import { SegmentService } from './segment.service';
import { SuppressionService } from './suppression.service';

const VALID_STATUSES: CampaignStatus[] = [
  'draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled',
];

export interface CampaignInput {
  name: string;
  type: CampaignType;
  segment_id: string;
  template_id?: string | null;
  sms_body?: string | null;
  scheduled_at?: string | null;
}

export interface CampaignPreview {
  segment_size: number;
  will_receive: number;
  email_suppressed: number;
  sms_suppressed: number;
  do_not_contact: number;
  missing_email: number;
  missing_phone: number;
  missing_consent_email: number;
  missing_consent_sms: number;
}

export class CampaignService {
  static async getCampaign(
    supabase: SupabaseClient,
    id: string,
  ): Promise<Campaign | null> {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    return (data as Campaign | null) ?? null;
  }

  static async listCampaigns(
    supabase: SupabaseClient,
    status?: CampaignStatus,
  ): Promise<Campaign[]> {
    let query = supabase
      .from('campaigns')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (status) query = query.eq('status', status);
    const { data, error } = await query;
    if (error) throw error;
    return (data as Campaign[]) ?? [];
  }

  // Compute who will actually receive the send, applying every gate the
  // fan-out worker will later apply. Same query path → same numbers → no
  // surprises at confirmation time.
  static async previewCampaign(
    supabase: SupabaseClient,
    input: { type: CampaignType; segment_id: string },
  ): Promise<CampaignPreview> {
    const segment = await SegmentService.getSegment(supabase, input.segment_id);
    if (!segment) throw new Error('SEGMENT_NOT_FOUND');

    const contacts = await SegmentService.resolveContacts(supabase, segment.conditions);

    let do_not_contact = 0;
    let missing_email = 0;
    let missing_phone = 0;
    let missing_consent_email = 0;
    let missing_consent_sms = 0;

    const emailsToCheck: string[] = [];
    const phonesToCheck: string[] = [];

    for (const c of contacts) {
      if (c.do_not_contact) {
        do_not_contact += 1;
        continue;
      }

      if (input.type === 'email' || input.type === 'mixed') {
        if (!c.email) missing_email += 1;
        else if (!c.consent_email) missing_consent_email += 1;
        else emailsToCheck.push(c.email);
      }
      if (input.type === 'sms' || input.type === 'mixed') {
        if (!c.phone) missing_phone += 1;
        else if (!c.consent_sms) missing_consent_sms += 1;
        else phonesToCheck.push(c.phone);
      }
    }

    const emailSup =
      emailsToCheck.length > 0
        ? await SuppressionService.filterEmailsSuppressed(supabase, emailsToCheck)
        : { allowed: [], suppressed: [] };
    const smsSup =
      phonesToCheck.length > 0
        ? await SuppressionService.filterPhonesSuppressed(supabase, phonesToCheck)
        : { allowed: [], suppressed: [] };

    // A contact "will receive" if at least one of their requested channels is
    // open. For mixed campaigns we count the contact once even if email + SMS
    // are both eligible, so the number reads as "people reached" rather than
    // "messages sent".
    const reachableEmails = new Set(emailSup.allowed);
    const reachablePhones = new Set(smsSup.allowed);
    let will_receive = 0;
    for (const c of contacts) {
      if (c.do_not_contact) continue;
      const emailOk =
        (input.type === 'email' || input.type === 'mixed') &&
        !!c.email && c.consent_email && reachableEmails.has(c.email);
      const smsOk =
        (input.type === 'sms' || input.type === 'mixed') &&
        !!c.phone && c.consent_sms && reachablePhones.has(c.phone);
      if (emailOk || smsOk) will_receive += 1;
    }

    return {
      segment_size: contacts.length,
      will_receive,
      email_suppressed: emailSup.suppressed.length,
      sms_suppressed: smsSup.suppressed.length,
      do_not_contact,
      missing_email,
      missing_phone,
      missing_consent_email,
      missing_consent_sms,
    };
  }

  // Insert a campaign row. recipient_count is left at 0 — fan-out re-resolves
  // the segment and writes accurate counts via updateCampaignCounters.
  static async createCampaign(
    supabase: SupabaseClient,
    input: CampaignInput,
    adminId: string | null,
  ): Promise<Campaign> {
    if (!input.name?.trim()) throw new Error('NAME_REQUIRED');
    if (!input.segment_id) throw new Error('SEGMENT_REQUIRED');
    if (input.type === 'email' && !input.template_id) throw new Error('TEMPLATE_REQUIRED');
    if (input.type === 'sms' && !input.sms_body?.trim()) throw new Error('SMS_BODY_REQUIRED');
    if (input.type === 'mixed' && !input.template_id) throw new Error('TEMPLATE_REQUIRED');
    if (input.type === 'mixed' && !input.sms_body?.trim()) throw new Error('SMS_BODY_REQUIRED');

    const scheduled = input.scheduled_at ? new Date(input.scheduled_at) : null;
    const status: CampaignStatus = scheduled ? 'scheduled' : 'draft';

    const { data, error } = await supabase
      .from('campaigns')
      .insert({
        name: input.name.trim(),
        type: input.type,
        status,
        segment_id: input.segment_id,
        template_id: input.template_id ?? null,
        sms_body: input.sms_body ?? null,
        scheduled_at: scheduled?.toISOString() ?? null,
        created_by: adminId,
      })
      .select('*')
      .single();
    if (error) throw error;

    if (adminId) {
      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'CREATE_CAMPAIGN',
        entity_type: 'campaign',
        entity_id: data.id,
        after_state: data,
      });
    }

    return data as Campaign;
  }

  static async setStatus(
    supabase: SupabaseClient,
    id: string,
    status: CampaignStatus,
    adminId: string | null,
    extra: Record<string, unknown> = {},
  ): Promise<Campaign> {
    if (!VALID_STATUSES.includes(status)) throw new Error('STATUS_INVALID');
    const { data, error } = await supabase
      .from('campaigns')
      .update({ status, ...extra })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    if (adminId) {
      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'UPDATE_CAMPAIGN_STATUS',
        entity_type: 'campaign',
        entity_id: id,
        after_state: { status, ...extra },
      });
    }
    return data as Campaign;
  }
}
