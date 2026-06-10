import { NextResponse, type NextRequest } from 'next/server';
import { authorizeDispatch, finalizeDispatch } from '@/lib/crm/dispatch-auth';
import { resolveDispatchContact } from '@/lib/crm/resolve-contact';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import { scoreLeadFromConversation } from '@/lib/services/acquisition/scoring.service';
import type { ExtractedData } from '@/lib/ai/acquisition';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// POST /api/crm/dispatch/score — Make.com calls this to (re)score a contact.
// Recomputes via scoring.service, persists score+temperature to the linked
// Buyer (when one exists) and a timeline event, audits, returns {score,
// temperature}.
//
// body: { contactId | email | phone, data?: Partial<ExtractedData>,
//         idempotencyKey, scenarioId? }
export async function POST(request: NextRequest) {
  const auth = await authorizeDispatch(request, 'dispatch/score');
  if (!auth.ok) return auth.response;
  if (auth.duplicate) return NextResponse.json(auth.priorResult);

  const { body, supabase, keyHash } = auth;

  const finalize = async (result: Record<string, unknown>, http = 200) => {
    await finalizeDispatch(supabase, keyHash, result, result.status === 'error' ? 'failed' : 'completed');
    return NextResponse.json(result, { status: http });
  };

  const contact = await resolveDispatchContact(supabase, {
    contactId: body.contactId as string | undefined,
    email: body.email as string | undefined,
    phone: body.phone as string | undefined,
  });
  if (!contact) return finalize({ status: 'contact_not_found' }, 404);

  // Shape scoring input from the supplied data merged with what the contact
  // already gives us (phone gates the hot tier in scoring.service).
  const supplied = (body.data as Partial<ExtractedData> | undefined) ?? {};
  const data: ExtractedData = {
    vehicleType: supplied.vehicleType ?? null,
    make: supplied.make ?? null,
    model: supplied.model ?? null,
    budgetTotal: supplied.budgetTotal ?? null,
    monthlyPayment: supplied.monthlyPayment ?? null,
    tradeIn: supplied.tradeIn ?? null,
    timeline: supplied.timeline ?? null,
    zip: supplied.zip ?? null,
    phone: supplied.phone ?? contact.phone ?? null,
  };

  const scored = await scoreLeadFromConversation(data);

  // Persist to the linked Buyer (the domain plane that owns lead_score /
  // lead_temperature) when the contact maps to one.
  let buyerUpdated = false;
  try {
    const { data: identity } = await supabase
      .from('contact_identities')
      .select('entity_id')
      .eq('contact_id', contact.id)
      .eq('entity_type', 'buyer')
      .maybeSingle();
    if (identity?.entity_id) {
      await prisma.buyer.update({
        where: { id: identity.entity_id as string },
        data: { leadScore: scored.score, leadTemperature: scored.temperature },
      });
      buyerUpdated = true;
    }
  } catch (err) {
    console.error('[dispatch/score] buyer persist failed:', err);
  }

  // Always record the score on the CRM timeline so it is visible regardless of
  // whether a Buyer row exists.
  await supabase.from('contact_timeline_events').insert({
    contact_id: contact.id,
    event_type: 'note_added',
    event_data: {
      kind: 'lead_score',
      score: scored.score,
      temperature: scored.temperature,
      signals: scored.signals,
      source: 'make_dispatch',
      scenario_id: (body.scenarioId as string | undefined) ?? null,
    },
  });

  await writeCrmAuditLog(
    supabase,
    { adminId: 'make_dispatch', adminEmail: 'make@autolenis.com' },
    {
      action: 'CRM_DISPATCH_SCORE',
      entity_type: 'contact',
      entity_id: contact.id,
      new_state: { score: scored.score, temperature: scored.temperature, buyer_updated: buyerUpdated },
    },
  );

  return finalize({
    status: 'scored',
    score: scored.score,
    temperature: scored.temperature,
  });
}
