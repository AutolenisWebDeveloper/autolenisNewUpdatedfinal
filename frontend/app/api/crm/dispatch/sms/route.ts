import { NextResponse, type NextRequest } from 'next/server';
import { authorizeDispatch, finalizeDispatch } from '@/lib/crm/dispatch-auth';
import { resolveDispatchContact } from '@/lib/crm/resolve-contact';
import { sendCrmSms, type CrmSmsFromPool } from '@/lib/services/sms/crm-sms';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

// POST /api/crm/dispatch/sms — Make.com calls this to ACT (send an SMS).
// TCPA consent, suppression, quiet hours, idempotency, the real Twilio outcome,
// and the audit trail are all owned here. Make never sends SMS itself.
//
// body: { contactId | phone, body, fromPool:'tollfree'|'local',
//         idempotencyKey, scenarioId? }
export async function POST(request: NextRequest) {
  const auth = await authorizeDispatch(request, 'dispatch/sms');
  if (!auth.ok) return auth.response;
  if (auth.duplicate) return NextResponse.json(auth.priorResult);

  const { body, supabase, keyHash } = auth;

  const contactId = body.contactId as string | undefined;
  const phone = body.phone as string | undefined;
  const messageBody = (body.body as string | undefined)?.trim();
  const fromPool = (body.fromPool as CrmSmsFromPool) === 'local' ? 'local' : 'tollfree';
  const scenarioId = (body.scenarioId as string | undefined) ?? null;
  const idempotencyKey = auth.idempotencyKey;

  const finalize = async (result: Record<string, unknown>, http = 200) => {
    await finalizeDispatch(
      supabase,
      keyHash,
      result,
      result.status === 'failed' ? 'failed' : 'completed',
    );
    return NextResponse.json(result, { status: http });
  };

  if (!messageBody) return finalize({ status: 'error', error: 'missing_body' }, 400);

  const contact = await resolveDispatchContact(supabase, { contactId, phone });
  if (!contact) {
    return finalize({ status: 'contact_not_found', error: 'no_contact_resolved' }, 404);
  }

  const result = await sendCrmSms({
    supabase,
    contact,
    body: messageBody,
    fromPool,
    idempotencyKey,
  });

  // Record the outcome to the buyer SMS log (contact_timeline_events) — the same
  // surface the Inngest SMS worker writes to. A non-delivered status is recorded
  // honestly, never as a send.
  await supabase.from('contact_timeline_events').insert({
    contact_id: contact.id,
    event_type: result.status === 'sent' ? 'sms_sent' : 'sms_failed',
    event_data: {
      dispatch: result.status,
      sid: result.sid ?? null,
      reason: result.reason ?? null,
      from_pool: fromPool,
      scenario_id: scenarioId,
    },
  });

  await writeCrmAuditLog(
    supabase,
    { adminId: 'make_dispatch', adminEmail: 'make@autolenis.com' },
    {
      action: 'CRM_DISPATCH_SMS',
      entity_type: 'contact',
      entity_id: contact.id,
      new_state: { status: result.status, sid: result.sid ?? null, from_pool: fromPool, scenario_id: scenarioId },
    },
  );

  const payload = { status: result.status, sid: result.sid ?? null, channel: 'sms' as const };
  // 200 for any deterministic gate (consent/suppression/quiet hours) — that's a
  // valid, expected outcome Make branches on. 502 only for a real send failure.
  const http = result.status === 'failed' ? 502 : 200;
  await finalizeDispatch(supabase, keyHash, payload, result.status === 'failed' ? 'failed' : 'completed');
  return NextResponse.json(payload, { status: http });
}
