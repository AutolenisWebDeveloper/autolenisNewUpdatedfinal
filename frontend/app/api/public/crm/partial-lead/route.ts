import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { inngest } from '@/lib/inngest/client';

// Captures Step 1 of the LP form before the buyer reaches Step 2. The CRM
// gets an email + (optional) phone the moment Step 1 validates, so a tab
// close between Step 1 and Step 2 no longer leaves us with no record.
//
// Always returns ok=true on errors — a CRM hiccup must never surface as a
// failure on the buyer's screen, which would block their progress to Step 2.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      firstName,
      lastName,
      email,
      phone,
      zip,
      smsConsent,
      campaign,
      utm_source,
      utm_medium,
      utm_campaign,
      source_url,
    } = body;

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json({ ok: false, reason: 'invalid_email' }, { status: 400 });
    }

    const supabase = getServiceSupabase();
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined;

    const contact = await ContactService.upsertContact(supabase, {
      email:        email.toLowerCase().trim(),
      phone:        phone || undefined,
      firstName:    firstName || undefined,
      lastName:     lastName  || undefined,
      source:       'public_form',
      utmSource:    utm_source    ?? undefined,
      utmMedium:    utm_medium    ?? undefined,
      utmCampaign:  utm_campaign  ?? undefined,
      sourceUrl:    source_url    ?? undefined,
      ipAddress:    ip,
      consentEmail: true,
      consentSms:   !!smsConsent,
      consentText:  'AutoLenis Landing Page — partial form capture (Step 1)',
    });

    // Only enroll the abandonment sequence for fresh leads. Contacts who
    // already advanced past 'lead' should not have their stage regressed or
    // be re-nurtured by an abandonment workflow they no longer match.
    const isEarlyStage = contact.lifecycle_stage === 'lead';

    if (isEarlyStage) {
      await supabase.from('contact_timeline_events').insert({
        contact_id: contact.id,
        event_type: 'note_added',
        event_data: {
          body: `Landing page form started but not completed. Step 1 captured. Campaign: ${campaign ?? 'unknown'}. ZIP: ${zip ?? 'not provided'}.`,
          source: 'lp_partial_capture',
        },
        created_by: null,
      });

      await inngest.send({
        name: 'autolenis/lead.form_abandoned',
        data: {
          contact_id:      contact.id,
          contact_email:   contact.email,
          first_name:      contact.first_name,
          campaign:        campaign ?? 'unknown',
          zip:             zip ?? null,
          // One abandonment sequence per contact per day — re-submits within
          // the same day fold into the existing in-flight workflow.
          idempotency_key: `form-abandon-${contact.id}-${new Date().toISOString().slice(0, 10)}`,
        },
      });
    }

    return NextResponse.json({ ok: true, contact_id: contact.id });
  } catch (err) {
    console.error('[partial-lead]', err);
    return NextResponse.json({ ok: true });
  }
}
