// lib/services/offer/outside-dealer.ts
// System "Outside Dealer" placeholder support.
//
// The Offer model requires a non-nullable dealerId. Offers submitted on behalf
// of dealers that have no Dealer account (outside auction invitees, or admin
// manual entries for unregistered dealers) point dealerId at a single system
// placeholder Dealer, while the real identity lives in the offer's
// externalDealer* fields. This keeps every existing `offer.dealer` access
// (best-price engine, comparison panel, dealer notifications) working without
// making dealerId nullable across the codebase.

import { prisma } from "@/lib/prisma";
import { UserRole, DealerStatus } from "@prisma/client";

export const OUTSIDE_DEALER_SUPABASE_ID = "system-outside-dealer-placeholder";
const OUTSIDE_DEALER_EMAIL = "outside-dealers@system.autolenis.local";
const OUTSIDE_DEALER_NAME = "AutoLenis Outside Dealer System";

/**
 * Returns the id of the system "Outside Dealer" placeholder, creating the
 * backing User + Dealer rows on first use. Safe against concurrent callers:
 * a unique-constraint collision falls back to a re-read.
 */
export async function getOrCreateOutsideDealerId(): Promise<string> {
  const existing = await prisma.dealer.findFirst({
    where: { user: { supabaseId: OUTSIDE_DEALER_SUPABASE_ID } },
    select: { id: true },
  });
  if (existing) return existing.id;

  try {
    const dealer = await prisma.$transaction(async (tx) => {
      const user =
        (await tx.user.findUnique({ where: { supabaseId: OUTSIDE_DEALER_SUPABASE_ID } })) ??
        (await tx.user.create({
          data: {
            supabaseId: OUTSIDE_DEALER_SUPABASE_ID,
            email: OUTSIDE_DEALER_EMAIL,
            role: UserRole.DEALER,
          },
        }));

      const existingDealer = await tx.dealer.findUnique({ where: { userId: user.id } });
      if (existingDealer) return existingDealer;

      return tx.dealer.create({
        data: {
          userId: user.id,
          dealershipName: OUTSIDE_DEALER_NAME,
          // TERMINATED keeps the placeholder out of every `status: "ACTIVE"`
          // query (auction invitation matching, public verified-dealer counts,
          // the admin active-dealer search) with no per-call-site edits. The
          // isSystemPlaceholder flag is the explicit, status-independent guard.
          status: DealerStatus.TERMINATED,
          tier: "STANDARD",
          isSystemPlaceholder: true,
        },
      });
    });
    return dealer.id;
  } catch {
    // Lost a race with a concurrent creator — the row now exists.
    const dealer = await prisma.dealer.findFirst({
      where: { user: { supabaseId: OUTSIDE_DEALER_SUPABASE_ID } },
      select: { id: true },
    });
    if (dealer) return dealer.id;
    throw new Error("Failed to resolve system Outside Dealer placeholder");
  }
}
