import 'server-only';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import type { LifecycleStage } from '@/lib/types/crm';
import type { CrmAuditActor } from '@/lib/services/admin/crm-audit';

// Mirrors a buyer lifecycle change onto the CRM contact record.
//
// Platform invariant: any admin action that advances a buyer's journey stage
// must write to BOTH the Prisma buyer/related tables AND the CRM contacts
// table. The Prisma side is owned by each action route; this helper owns the
// CRM side so the call sites stay one line.
//
// Resolution order:
//   1. contact_identities link (entity_type='buyer', entity_id=buyerId)
//   2. email match — and, on a hit, backfill the identity link so future
//      syncs skip the email lookup.
//
// Best-effort by design: a CRM outage must never roll back or block the
// authoritative Prisma mutation. Failures are logged and swallowed.
export async function syncBuyerLifecycleToCrm(
  buyerId: string,
  stage: LifecycleStage,
  actor: CrmAuditActor | null,
  buyerEmail?: string | null,
): Promise<{ synced: boolean }> {
  try {
    const supabase = getServiceSupabase();

    const { data: identity } = await supabase
      .from('contact_identities')
      .select('contact_id')
      .eq('entity_type', 'buyer')
      .eq('entity_id', buyerId)
      .maybeSingle();

    let contactId = (identity as { contact_id?: string } | null)?.contact_id;

    if (!contactId && buyerEmail) {
      const { data } = await ContactService.findContactByEmail(supabase, buyerEmail);
      contactId = (data as { id?: string } | null)?.id;
      if (contactId) {
        await ContactService.linkContactIdentity(supabase, contactId, 'buyer', buyerId, true);
      }
    }

    if (!contactId) return { synced: false };

    await ContactService.updateLifecycleStage(supabase, contactId, stage, actor);
    return { synced: true };
  } catch (err) {
    console.error('[buyer-crm-sync] lifecycle sync failed', { buyerId, stage, err });
    return { synced: false };
  }
}
