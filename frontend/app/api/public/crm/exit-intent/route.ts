import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { inngest } from '@/lib/inngest/client';

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

    if (contact.lifecycle_stage === 'lead') {
      await inngest.send({
        name: 'autolenis/lead.exit_intent_captured',
        data: {
          contact_id:      contact.id,
          contact_email:   contact.email,
          first_name:      contact.first_name,
          campaign:        campaign ?? 'unknown',
          idempotency_key: `exit-intent-${contact.id}-${new Date().toISOString().slice(0, 10)}`,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[exit-intent]', err);
    return NextResponse.json({ ok: true });
  }
}
