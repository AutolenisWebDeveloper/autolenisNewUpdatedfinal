import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeEmail, normalizePhone } from '../utils/phone';
import type { Contact, ContactInput, ContactUpdate, LifecycleStage } from '../types/crm';

export class ContactService {
  // Dedup priority: email match → phone match → insert. Consent merges upward
  // (never downgrade). consent_ip / consent_text overwrite when a new opt-in
  // arrives so the latest disclosure context is what's on record.
  static async upsertContact(supabase: SupabaseClient, input: ContactInput): Promise<Contact> {
    const cleanEmail = normalizeEmail(input.email ?? null);
    const standardizedPhone = input.phone ? normalizePhone(input.phone) : null;

    let existing: Contact | null = null;

    if (cleanEmail) {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('email', cleanEmail)
        .is('deleted_at', null)
        .maybeSingle();
      existing = data;
    }

    if (!existing && standardizedPhone) {
      const { data } = await supabase
        .from('contacts')
        .select('*')
        .eq('phone', standardizedPhone)
        .is('deleted_at', null)
        .maybeSingle();
      existing = data;
    }

    const now = new Date().toISOString();
    const optInThisCall = !!(input.consentSms || input.consentEmail);

    if (existing) {
      const consentSms = existing.consent_sms || !!input.consentSms;
      const consentEmail = existing.consent_email || !!input.consentEmail;

      const update: Partial<Contact> = {
        email: existing.email ?? cleanEmail,
        phone: existing.phone ?? standardizedPhone,
        first_name: input.firstName ?? existing.first_name,
        last_name: input.lastName ?? existing.last_name,
        consent_sms: consentSms,
        consent_email: consentEmail,
        updated_at: now,
      };

      if (optInThisCall) {
        update.consent_at = now;
        if (input.consentIp) update.consent_ip = input.consentIp;
        if (input.consentText) update.consent_text = input.consentText;
      }

      const { data, error } = await supabase
        .from('contacts')
        .update(update)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;
      return data as Contact;
    }

    const { data, error } = await supabase
      .from('contacts')
      .insert({
        email: cleanEmail,
        phone: standardizedPhone,
        first_name: input.firstName ?? null,
        last_name: input.lastName ?? null,
        source: input.source,
        utm_source: input.utmSource ?? null,
        utm_medium: input.utmMedium ?? null,
        utm_campaign: input.utmCampaign ?? null,
        source_url: input.sourceUrl ?? null,
        ip_address: input.ipAddress ?? null,
        consent_sms: !!input.consentSms,
        consent_email: !!input.consentEmail,
        consent_at: optInThisCall ? now : null,
        consent_ip: optInThisCall ? input.consentIp ?? null : null,
        consent_text: optInThisCall ? input.consentText ?? null : null,
        lifecycle_stage: 'lead',
      })
      .select()
      .single();

    if (error) throw error;
    return data as Contact;
  }

  static async linkContactIdentity(
    supabase: SupabaseClient,
    contactId: string,
    entityType: 'buyer' | 'dealer' | 'affiliate' | 'refinance_lead',
    entityId: string,
    isPrimary = false
  ): Promise<void> {
    await supabase.from('contact_identities').upsert(
      {
        contact_id: contactId,
        entity_type: entityType,
        entity_id: entityId,
        is_primary: isPrimary,
      },
      { onConflict: 'entity_type,entity_id' }
    );
  }

  static async getContactById(supabase: SupabaseClient, id: string): Promise<Contact | null> {
    const { data, error } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    return (data as Contact) ?? null;
  }

  static async findContactByEmail(supabase: SupabaseClient, email: string) {
    const clean = normalizeEmail(email);
    if (!clean) return { data: null };
    return supabase
      .from('contacts')
      .select('*')
      .eq('email', clean)
      .is('deleted_at', null)
      .maybeSingle();
  }

  static async findContactByPhone(supabase: SupabaseClient, phone: string) {
    const standardized = normalizePhone(phone);
    if (!standardized) return { data: null };
    return supabase
      .from('contacts')
      .select('*')
      .eq('phone', standardized)
      .is('deleted_at', null)
      .maybeSingle();
  }

  // adminId is required for attribution. Pass null only when no authenticated
  // admin session is available — in that case the audit_log write is skipped
  // entirely rather than recorded against a placeholder UUID. An unlogged
  // mutation is preferable to a fraudulently attributed one.
  static async updateContact(
    supabase: SupabaseClient,
    id: string,
    updates: ContactUpdate,
    adminId: string | null
  ): Promise<Contact> {
    const { data: before } = await supabase
      .from('contacts')
      .select('*')
      .eq('id', id)
      .single();

    const patch: Partial<Contact> = { ...updates, updated_at: new Date().toISOString() };
    if (patch.phone) patch.phone = normalizePhone(patch.phone);
    if (patch.email) patch.email = normalizeEmail(patch.email);

    const { data, error } = await supabase
      .from('contacts')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    if (adminId) {
      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'UPDATE_CONTACT',
        entity_type: 'contact',
        entity_id: id,
        before_state: before,
        after_state: data,
      });
    }

    return data as Contact;
  }

  static async updateLifecycleStage(
    supabase: SupabaseClient,
    id: string,
    newStage: LifecycleStage,
    adminId: string | null
  ): Promise<Contact> {
    const { data: before } = await supabase
      .from('contacts')
      .select('lifecycle_stage')
      .eq('id', id)
      .single();

    const { data, error } = await supabase
      .from('contacts')
      .update({ lifecycle_stage: newStage, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    await supabase.from('contact_timeline_events').insert({
      contact_id: id,
      event_type: 'stage_changed',
      event_data: { from: before?.lifecycle_stage, to: newStage },
      created_by: adminId,
    });

    if (adminId) {
      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'UPDATE_LIFECYCLE_STAGE',
        entity_type: 'contact',
        entity_id: id,
        before_state: { lifecycle_stage: before?.lifecycle_stage },
        after_state: { lifecycle_stage: newStage },
      });
    }

    return data as Contact;
  }

  static async softDeleteContact(
    supabase: SupabaseClient,
    id: string,
    adminId: string | null
  ): Promise<void> {
    await supabase
      .from('contacts')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (adminId) {
      await supabase.from('admin_audit_log').insert({
        admin_id: adminId,
        action: 'SOFT_DELETE_CONTACT',
        entity_type: 'contact',
        entity_id: id,
      });
    }
  }
}
