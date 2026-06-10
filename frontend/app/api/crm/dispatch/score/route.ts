import { NextResponse, type NextRequest } from 'next/server';
import { authorizeDispatch, finalizeDispatch } from '@/lib/crm/dispatch-auth';
import { resolveDispatchContact } from '@/lib/crm/resolve-contact';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';
import { scoreLeadFromConversation } from '@/lib/services/acquisition/scoring.service';
import { pickHigherScore, isThinScoreInput } from '@/lib/crm/score-policy';
import type { ExtractedData } from '@/lib/ai/acquisition';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

// Scoring-relevant fields (phone is a tier-gate, not a signal). A call carrying
// none of these is "thin" and must not clobber a higher prior score (Fix E).
const SIGNAL_FIELDS: (keyof ExtractedData)[] = [
  'vehicleType', 'make', 'model', 'budgetTotal', 'monthlyPayment', 'tradeIn', 'timeline', 'zip',
];

// POST /api/crm/dispatch/score — Make.com calls this to (re)score a contact.
// Persists for ANY contact via a LeadScore row + the contacts plane (Fix D),
// updates the linked Buyer when one exists, never downgrades a higher prior
// score (Fix E), writes a timeline event, audits, returns {score, temperature}.
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

  // Linked buyer (if any) — owns Buyer.leadScore on the domain plane.
  let buyerId: string | null = null;
  try {
    const { data: identity } = await supabase
      .from('contact_identities')
      .select('entity_id')
      .eq('contact_id', contact.id)
      .eq('entity_type', 'buyer')
      .maybeSingle();
    buyerId = (identity?.entity_id as string | undefined) ?? null;
  } catch (err) {
    console.error('[dispatch/score] buyer identity lookup failed:', err);
  }

  // Gather the existing (prior) score from every plane so we never downgrade.
  let existingScore: number | null = null;
  let existingTemp: string | null = null;
  const consider = (s: number | null | undefined, t: string | null | undefined) => {
    if (typeof s === 'number' && (existingScore === null || s > existingScore)) {
      existingScore = s;
      existingTemp = t ?? existingTemp;
    }
  };
  // contacts plane (sortable lead_score column — migration 06)
  const contactRow = contact as unknown as { lead_score?: number | null; lead_temperature?: string | null };
  consider(contactRow.lead_score ?? null, contactRow.lead_temperature ?? null);
  // most recent LeadScore row for this contact (by buyer link or contact ref)
  try {
    const prior = await prisma.leadScore.findFirst({
      where: { OR: [{ sessionId: contact.id }, ...(buyerId ? [{ buyerId }] : [])] },
      orderBy: { createdAt: 'desc' },
    });
    consider(prior?.score ?? null, prior?.temperature ?? null);
  } catch (err) {
    console.error('[dispatch/score] prior LeadScore lookup failed:', err);
  }
  // linked Buyer plane
  if (buyerId) {
    try {
      const buyer = await prisma.buyer.findUnique({
        where: { id: buyerId },
        select: { leadScore: true, leadTemperature: true },
      });
      consider(buyer?.leadScore ?? null, buyer?.leadTemperature ?? null);
    } catch (err) {
      console.error('[dispatch/score] buyer score lookup failed:', err);
    }
  }

  // Shape scoring input from the supplied data + the contact's phone.
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
  const thinInput = isThinScoreInput(supplied as Record<string, unknown>, SIGNAL_FIELDS as string[]);

  const scored = await scoreLeadFromConversation(data);

  // No-downgrade (Fix E): persist max(existing, computed). A thin input that
  // computes lower than a stored higher score keeps the higher score+temperature.
  const existing = existingScore !== null ? { score: existingScore, temperature: existingTemp ?? scored.temperature } : null;
  const { score: finalScore, temperature: finalTemp } = pickHigherScore(existing, {
    score: scored.score,
    temperature: scored.temperature,
  });

  // (D) Always write a LeadScore row — keyed by buyerId when linked, and by the
  // contact reference (sessionId) so contacts with NO buyer still persist.
  try {
    await prisma.leadScore.create({
      data: {
        buyerId: buyerId ?? null,
        sessionId: contact.id,
        score: finalScore,
        temperature: finalTemp,
        signals: scored.signals,
        reasoning: scored.reasoning,
      },
    });
  } catch (err) {
    console.error('[dispatch/score] LeadScore persist failed:', err);
  }

  // (D) Sortable contacts plane — visible to the Leads/Segments UI for all contacts.
  try {
    await supabase
      .from('contacts')
      .update({ lead_score: finalScore, lead_temperature: finalTemp })
      .eq('id', contact.id);
  } catch (err) {
    console.error('[dispatch/score] contacts plane update failed:', err);
  }

  // (D) Linked Buyer plane — only when a buyer identity exists.
  let buyerUpdated = false;
  if (buyerId) {
    try {
      await prisma.buyer.update({
        where: { id: buyerId },
        data: { leadScore: finalScore, leadTemperature: finalTemp },
      });
      buyerUpdated = true;
    } catch (err) {
      console.error('[dispatch/score] buyer persist failed:', err);
    }
  }

  // CRM timeline reflects the score regardless of buyer linkage.
  await supabase.from('contact_timeline_events').insert({
    contact_id: contact.id,
    event_type: 'note_added',
    event_data: {
      kind: 'lead_score',
      score: finalScore,
      temperature: finalTemp,
      computed_score: scored.score,
      signals: scored.signals,
      thin_input: thinInput,
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
      new_state: {
        score: finalScore,
        temperature: finalTemp,
        computed_score: scored.score,
        prior_score: existingScore,
        thin_input: thinInput,
        buyer_updated: buyerUpdated,
      },
    },
  );

  return finalize({ status: 'scored', score: finalScore, temperature: finalTemp });
}
