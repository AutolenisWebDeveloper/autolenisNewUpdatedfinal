import { NextResponse } from 'next/server';
import twilio from 'twilio';
import { getServiceSupabase } from '@/lib/supabase-service';
import { requirePermissionActor } from '@/lib/auth/permissions';
import { SuppressionService } from '@/lib/services/suppression.service';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as { body?: string; is_internal_note?: boolean };

  const text = (body.body ?? '').trim();
  if (!text) {
    return NextResponse.json({ error: 'BODY_REQUIRED' }, { status: 400 });
  }

  const isInternalNote = !!body.is_internal_note;
  const actor = await requirePermissionActor("comms.bulk_send");
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const adminId = actor.adminId;
  const supabase = getServiceSupabase();

  const { data: conversation, error: convErr } = await supabase
    .from('conversations')
    .select('id, contact_id, phone, channel')
    .eq('id', id)
    .single();

  if (convErr || !conversation) {
    return NextResponse.json({ error: 'CONVERSATION_NOT_FOUND' }, { status: 404 });
  }

  const now = new Date().toISOString();

  // Internal note — never leaves the system.
  if (isInternalNote) {
    const { data: inserted, error: insertErr } = await supabase
      .from('conversation_messages')
      .insert({
        conversation_id: id,
        direction: 'internal',
        sender_type: 'admin',
        sender_id: adminId,
        body: text,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    await supabase
      .from('conversations')
      .update({ last_message_at: now, updated_at: now })
      .eq('id', id);

    return NextResponse.json({ message: inserted });
  }

  // Outbound SMS — check suppression before dispatch.
  const toPhone = conversation.phone;
  if (!toPhone) {
    return NextResponse.json({ error: 'NO_PHONE_ON_CONVERSATION' }, { status: 400 });
  }

  const suppressed = await SuppressionService.isSmsSuppressed(supabase, toPhone);
  if (suppressed) {
    return NextResponse.json({ error: 'PHONE_SUPPRESSED' }, { status: 409 });
  }

  let twilioSid: string | null = null;
  try {
    const client = twilio(
      process.env.TWILIO_ACCOUNT_SID!,
      process.env.TWILIO_AUTH_TOKEN!,
    );
    const result = await client.messages.create({
      from: process.env.TWILIO_FROM_NUMBER!,
      to: toPhone,
      body: text,
    });
    twilioSid = result.sid;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'TWILIO_SEND_FAILED';
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: id,
      direction: 'outbound',
      sender_type: 'admin',
      sender_id: adminId,
      body: text,
      twilio_sid: twilioSid,
    })
    .select()
    .single();

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  await supabase
    .from('conversations')
    .update({ last_message_at: now, updated_at: now })
    .eq('id', id);

  await supabase.from('contact_timeline_events').insert({
    contact_id: conversation.contact_id,
    event_type: 'sms_sent',
    event_data: { twilio_sid: twilioSid, source: 'admin_inbox_reply' },
    created_by: adminId,
  });

  await writeCrmAuditLog(supabase, actor, {
    action: 'CONVERSATION_REPLY_SENT',
    entity_type: 'conversation',
    entity_id: id,
    metadata: { twilio_sid: twilioSid, channel: conversation.channel },
  });

  return NextResponse.json({ message: inserted });
}
