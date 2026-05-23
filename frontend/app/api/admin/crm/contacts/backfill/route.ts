import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase-service';
import { ContactService } from '@/lib/services/contact.service';
import { prisma } from '@/lib/prisma';
import { getAdminActor } from '@/lib/auth/admin-actor';
import { writeCrmAuditLog } from '@/lib/services/admin/crm-audit';

export const dynamic = 'force-dynamic';

// One-time backfill: walks Prisma buyers/dealers/affiliates and upserts a
// matching Supabase contacts row + contact_identities link. Safe to re-run —
// upsert dedups by email/phone and the identity unique constraint prevents
// double-linking.
export async function POST() {
  const actor = await getAdminActor();
  if (!actor) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });
  const supabase = getServiceSupabase();

  let buyers_synced = 0;
  let dealers_synced = 0;
  let affiliates_synced = 0;
  const errors: { entity_type: string; entity_id: string; error: string }[] = [];

  // ── Buyers ─────────────────────────────────────────────────────────────────
  try {
    const buyers = await prisma.buyer.findMany({
      where: {
        archivedAt: null,
        purgedAt: null,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        user: { select: { email: true } },
      },
    });

    for (const buyer of buyers) {
      try {
        const contact = await ContactService.upsertContact(supabase, {
          email: buyer.user?.email ?? null,
          phone: buyer.phone ?? null,
          firstName: buyer.firstName,
          lastName: buyer.lastName,
          source: 'buyer_signup',
          consentEmail: true,
          consentText: 'AutoLenis buyer backfill',
        });
        await ContactService.linkContactIdentity(supabase, contact.id, 'buyer', buyer.id);
        buyers_synced++;
      } catch (err) {
        errors.push({
          entity_type: 'buyer',
          entity_id: buyer.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    errors.push({
      entity_type: 'buyer',
      entity_id: '*',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Dealers ────────────────────────────────────────────────────────────────
  try {
    const dealers = await prisma.dealer.findMany({
      where: {
        status: 'ACTIVE',
      },
      select: {
        id: true,
        dealershipName: true,
        phone: true,
        user: { select: { email: true } },
      },
    });

    for (const dealer of dealers) {
      try {
        const contact = await ContactService.upsertContact(supabase, {
          email: dealer.user?.email ?? null,
          phone: dealer.phone ?? null,
          firstName: dealer.dealershipName,
          lastName: '',
          source: 'dealer_signup',
          consentEmail: true,
          consentText: 'AutoLenis dealer backfill',
        });
        await ContactService.linkContactIdentity(supabase, contact.id, 'dealer', dealer.id);
        dealers_synced++;
      } catch (err) {
        errors.push({
          entity_type: 'dealer',
          entity_id: dealer.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    errors.push({
      entity_type: 'dealer',
      entity_id: '*',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Affiliates ─────────────────────────────────────────────────────────────
  try {
    const affiliates = await prisma.affiliate.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        user: { select: { email: true } },
        profile: { select: { firstName: true, lastName: true, phone: true } },
      },
    });

    for (const aff of affiliates) {
      try {
        const contact = await ContactService.upsertContact(supabase, {
          email: aff.user?.email ?? null,
          phone: aff.profile?.phone ?? null,
          firstName: aff.profile?.firstName ?? undefined,
          lastName: aff.profile?.lastName ?? undefined,
          source: 'affiliate_signup',
          consentEmail: true,
          consentText: 'AutoLenis affiliate backfill',
        });
        await ContactService.linkContactIdentity(supabase, contact.id, 'affiliate', aff.id);
        affiliates_synced++;
      } catch (err) {
        errors.push({
          entity_type: 'affiliate',
          entity_id: aff.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  } catch (err) {
    errors.push({
      entity_type: 'affiliate',
      entity_id: '*',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  await writeCrmAuditLog(supabase, actor, {
    action: 'CRM_CONTACTS_BACKFILL',
    entity_type: 'contact',
    entity_id: 'backfill',
    metadata: {
      buyers_synced,
      dealers_synced,
      affiliates_synced,
      errors_count: errors.length,
    },
  });

  return NextResponse.json({
    buyers_synced,
    dealers_synced,
    affiliates_synced,
    errors,
  });
}
