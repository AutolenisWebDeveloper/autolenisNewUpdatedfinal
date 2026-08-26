// lib/services/deal/deal-completion-event.service.ts
// Program 4 — the canonical "deal completed" domain event.
//
// Emitted EXACTLY ONCE from the deal state-machine seam (advanceDealStatus) the
// moment a deal enters COMPLETED. Exactly-once is structural, not best-effort:
// COMPLETED is a terminal state and advanceDealStatus advances into it via a
// compare-and-swap, so only the winning transition ever reaches this call — a
// replay/concurrent transition short-circuits on the idempotent no-op and never
// re-emits.
//
// This is the single canonical completion condition Program 5 (Affiliate Growth
// + Settlement) will consume. It is deliberately NOT a new event type: it reuses
// the existing `purchase_completed` domain event (Program 2's CRM/Make spine),
// keyed on dealId, so the completion signal lives in one place instead of being
// re-emitted from each completion route.
//
// Best-effort: it NEVER throws to the caller — the deal has already been marked
// COMPLETED and committed before this runs, exactly like emitDealStatusComms.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";

export async function emitDealCompletionEvent(dealId: string): Promise<void> {
  try {
    const deal = await prisma.deal.findUnique({
      where: { id: dealId },
      include: { buyer: { include: { user: { select: { email: true } } } } },
    });
    // No buyer contact → nothing meaningful to emit (and the CRM contact resolve
    // would fail anyway). Silent, non-fatal.
    if (!deal?.buyer) return;

    const { emitDomainEvent } = await import("@/lib/events/emit");
    await emitDomainEvent("purchase_completed", {
      domainEntityId: dealId,
      contact: {
        email: deal.buyer.user?.email ?? null,
        phone: deal.buyer.phone ?? null,
        firstName: deal.buyer.firstName,
        lastName: deal.buyer.lastName,
        source: "buyer_signup",
      },
      data: {
        deal_id: dealId,
        buyer_id: deal.buyerId,
        // The winning offer (auction path) or the accepted vehicle-request offer
        // (concierge path) — whichever produced this canonical Deal.
        offer_id: deal.offerId ?? deal.vehicleRequestOfferId ?? null,
        completed_at: new Date().toISOString(),
      },
    });
  } catch (err) {
    logger.error("[deal-completion-event] emit failed (non-fatal):", err);
  }
}
