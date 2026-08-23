import { logger } from "@/lib/logger";
import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { scheduleLeadNurture } from '@/lib/services/crm/lead-nurture.service';

// Captures email from the exit-intent modal. Buyer was about to leave the LP
// without engaging the form at all — softer touch than the abandonment
// sequence (single recovery email, not 3 touches).
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { email, campaign, utm_source, utm_medium, utm_campaign, source_url } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;

    const contact = await ContactService.upsertContact(supabase, {
      email:        email.toLowerCase().trim(),
      source:       'public_form',
      utmSource:    utm_source   ?? undefined,
      utmMedium:    utm_medium   ?? undefined,
      utmCampaign:  utm_campaign ?? undefined,
      sourceUrl:    source_url   ?? undefined,
      ipAddress:    ip,
      consentEmail: true,
      consentSms:   false,
      consentText:  'AutoLenis Landing Page — exit intent capture',
    });

    await supabase.from('contact_timeline_events').insert({
      contact_id: contact.id,
      event_type: 'note_added',
      event_data: {
        body: `Exit intent email captured. Campaign: ${campaign ?? 'unknown'}. Contact was about to leave the landing page.`,
        source: 'lp_exit_intent',
      },
      created_by: null,
    });

    // Schedule the durable single-touch exit-intent recovery (internal cron,
    // not Inngest). One recovery per contact per day — a re-trigger within the
    // same day folds into the existing schedule (UNIQUE idempotency_key+step).
    if (contact.lifecycle_stage === 'lead') {
      await scheduleLeadNurture('exit_intent', {
        contactId:      contact.id,
        // contact.email is nullable in the row type but always set here (the
        // route rejected a missing email above and upserted this exact value).
        contactEmail:   contact.email ?? email.toLowerCase().trim(),
        firstName:      contact.first_name ?? null,
        campaign:       campaign ?? 'unknown',
        idempotencyKey: `exit-intent-${contact.id}-${new Date().toISOString().slice(0, 10)}`,
      });
    }

    // Per-source domain event (additive, non-blocking) — emits
    // exit_intent_captured so Make can attach a recovery scenario. The emit
    // re-resolves the contact (idempotent email dedup) and mirrors the consent
    // captured above: email implied by submission. This form has NO SMS opt-in
    // field, so no consentSms key is passed (never defaulted true).
    try {
      const { emitDomainEvent } = await import('@/lib/events/emit');
      await emitDomainEvent('exit_intent_captured', {
        domainEntityId: contact.id,
        supabase,
        contact: {
          email:        email.toLowerCase().trim(),
          source:       'exit_intent',
          utmSource:    utm_source   ?? undefined,
          utmMedium:    utm_medium   ?? undefined,
          utmCampaign:  utm_campaign ?? undefined,
          sourceUrl:    source_url   ?? undefined,
          ipAddress:    ip,
          consentEmail: true,
        },
        data: {
          campaign: campaign ?? 'unknown',
        },
      });
    } catch (emitErr) {
      logger.error('[exit-intent] CRM emit failed:', emitErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    logger.error('[exit-intent]', err);
    return NextResponse.json({ ok: true });
  }
}
