import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from 'next/server';
import twilio from 'twilio';
import { createClient } from '@supabase/supabase-js';
import { ContactService } from '@/lib/services/contact.service';
import { SuppressionService } from '@/lib/services/suppression.service';
import { normalizePhone } from '@/lib/utils/phone';
import { claimProviderEvent } from '@/lib/services/webhooks/provider-event-dedup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STOP_KEYWORDS = new Set(['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT']);
const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP']);
const HELP_KEYWORDS = new Set(['HELP', 'INFO']);

function twimlResponse(body: string): NextResponse {
  return new NextResponse(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await req.text();
    const params = Object.fromEntries(new URLSearchParams(rawBody)) as Record<string, string>;
    const signature = req.headers.get('x-twilio-signature') ?? '';
    const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/twilio/inbound`;

    const valid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN ?? '',
      signature,
      webhookUrl,
      params
    );
    if (!valid) {
      return new NextResponse('Unauthorized', { status: 403 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const messageBody = (params.Body ?? '').trim();
    const standardizedPhone = normalizePhone(params.From ?? '');
    const keyword = messageBody.toUpperCase();

    if (!standardizedPhone) {
      return twimlResponse('<Response/>');
    }

    const twiml = new twilio.twiml.MessagingResponse();

    if (STOP_KEYWORDS.has(keyword)) {
      await SuppressionService.suppressSms(supabase, standardizedPhone, 'stop');
      twiml.message(
        'You have been unsubscribed from AutoLenis. No further messages will be sent. Reply START to opt back in (manual review required).'
      );
      return twimlResponse(twiml.toString());
    }

    if (START_KEYWORDS.has(keyword)) {
      await SuppressionService.handleSmsStart(supabase, standardizedPhone);
      twiml.message(
        'AutoLenis received your opt-in request. An agent will verify your consent before SMS resumes.'
      );
      return twimlResponse(twiml.toString());
    }

    if (HELP_KEYWORDS.has(keyword)) {
      twiml.message(
        `AutoLenis support: ${process.env.SUPPORT_EMAIL ?? 'support@autolenis.com'} | ${process.env.SUPPORT_PHONE ?? ''}. Msg & data rates may apply. Reply STOP to opt out.`
      );
      return twimlResponse(twiml.toString());
    }

    // Inbox routing — find/create contact, find/open conversation, append message.
    // Replay dedup on Twilio's MessageSid: a retried delivery must not insert a
    // duplicate inbound message, re-bump unread_count, or duplicate the timeline
    // event. Only the inbox path is guarded — STOP/START/HELP above are keyword
    // handlers that are already idempotent by construction. (When MessageSid is
    // absent we cannot dedup and fall through to normal handling.)
    const messageSid = params.MessageSid ?? '';
    const inboxClaim = messageSid
      ? await claimProviderEvent({
          provider: 'twilio',
          eventId: messageSid,
          eventType: 'sms.inbound',
          payload: { From: standardizedPhone, Body: messageBody, MessageSid: messageSid },
        })
      : null;
    if (inboxClaim?.status === 'duplicate') return twimlResponse('<Response/>');
    if (inboxClaim?.status === 'in_progress') {
      return new NextResponse('Concurrent delivery in progress', { status: 503 });
    }

    let { data: contact } = await ContactService.findContactByPhone(supabase, standardizedPhone);
    if (!contact) {
      contact = await ContactService.upsertContact(supabase, {
        phone: standardizedPhone,
        source: 'sms_inbound',
      });
    }

    const { data: existingConv } = await supabase
      .from('conversations')
      .select('id, unread_count, status')
      .eq('contact_id', contact.id)
      .eq('channel', 'sms')
      .order('last_message_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let conversationId: string;
    if (existingConv) {
      conversationId = existingConv.id;
      const reopenStatus =
        existingConv.status === 'resolved' ? 'open' : existingConv.status;
      await supabase
        .from('conversations')
        .update({
          unread_count: (existingConv.unread_count ?? 0) + 1,
          status: reopenStatus,
          last_message_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingConv.id);
    } else {
      const { data: newConv, error } = await supabase
        .from('conversations')
        .insert({
          contact_id: contact.id,
          phone: standardizedPhone,
          channel: 'sms',
          unread_count: 1,
          status: 'open',
          last_message_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (error) throw error;
      conversationId = newConv.id;
    }

    await supabase.from('conversation_messages').insert({
      conversation_id: conversationId,
      direction: 'inbound',
      sender_type: 'contact',
      sender_id: contact.id,
      body: messageBody,
      twilio_sid: params.MessageSid ?? null,
    });

    await supabase.from('contact_timeline_events').insert({
      contact_id: contact.id,
      event_type: 'sms_received',
      event_data: { body: messageBody, sms_sid: params.MessageSid ?? null },
    });

    // Mark this MessageSid processed so a Twilio redelivery is deduped above.
    if (inboxClaim?.status === 'claimed') await inboxClaim.settle();

    return twimlResponse('<Response/>');
  } catch (err) {
    logger.error('[twilio.inbound] fatal', err);
    return new NextResponse('Internal Webhook Failure', { status: 500 });
  }
}
