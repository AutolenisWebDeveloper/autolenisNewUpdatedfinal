import { NextResponse, type NextRequest } from 'next/server';
import { authorizeDispatch, finalizeDispatch } from '@/lib/crm/dispatch-auth';
import { resolveDispatchContact } from '@/lib/crm/resolve-contact';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import { recordScoringAction } from '@/lib/services/crm/lead-action-scoring.service';
import { isScoringAction } from '@/lib/crm/scoring-actions';

export const dynamic = 'force-dynamic';

// POST /api/crm/dispatch/track — Make.com (or an internal seam) reports a scored
// behavior for a contact. Accrues the action's points onto the cumulative
// lead_score, re-derives temperature, and opens a priority-outreach task on the
// first hot-threshold crossing. Additive + idempotent → safe to retry.
//
// body: { contactId | email | phone, action, source?, metadata?,
//         idempotencyKey, scenarioId? }
export async function POST(request: NextRequest) {
  const auth = await authorizeDispatch(request, 'dispatch/track');
  if (!auth.ok) return auth.response;
  if (auth.duplicate) return NextResponse.json(auth.priorResult);

  const { body, supabase, keyHash, idempotencyKey } = auth;

  const finalize = async (result: Record<string, unknown>, http = 200) => {
    await finalizeDispatch(supabase, keyHash, result, result.status === 'error' ? 'failed' : 'completed');
    return NextResponse.json(result, { status: http });
  };

  const action = body.action;
  if (!isScoringAction(action)) {
    return finalize({ status: 'bad_request', error: 'invalid_action' }, 400);
  }

  const contact = await resolveDispatchContact(supabase, {
    contactId: body.contactId as string | undefined,
    email: body.email as string | undefined,
    phone: body.phone as string | undefined,
  });
  if (!contact) return finalize({ status: 'contact_not_found' }, 404);

  const result = await recordScoringAction(supabase, {
    contactId: contact.id,
    action,
    source: (body.source as string | undefined) ?? 'make_dispatch',
    // Bind dedup to the dispatch idempotency key so the ledger and the endpoint
    // agree on "already processed".
    idempotencyKey,
    metadata: (body.metadata as Record<string, unknown> | undefined) ?? {},
  });

  await writeCrmAuditLog(
    supabase,
    { adminId: 'make_dispatch', adminEmail: 'make@autolenis.com' },
    {
      action: 'CRM_DISPATCH_TRACK',
      entity_type: 'contact',
      entity_id: contact.id,
      new_state: {
        scored_action: action,
        points_added: result.pointsAdded,
        score: result.score,
        temperature: result.temperature,
        task_created: result.taskCreated,
        scenario_id: (body.scenarioId as string | undefined) ?? null,
      },
    },
  );

  return finalize({
    status: result.status,
    score: result.score,
    temperature: result.temperature,
    pointsAdded: result.pointsAdded,
    taskCreated: result.taskCreated,
  });
}
