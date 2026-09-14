import type { Metadata } from "next";

export const metadata: Metadata = { title: "Offers", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import OfferComparisonPanel from "@/components/buyer/OfferComparisonPanel";
import PremiumReportMention from "@/components/buyer/PremiumReportMention";
import { isUpgradePromptSuppressed, UPGRADE_TOUCHPOINTS } from "@/lib/services/plan/upgrade-suppression.service";
import { upgradeAskCounts, recordImpression } from "@/lib/services/plan/upgrade-touchpoint.service";
import { quotePremiumBalance } from "@/lib/services/plan/upgrade-window.service";
import { qualifiedOfferWhere } from "@/lib/services/offer/offer-validity";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ auctionId: string }> }

export default async function AuctionOffersPage({ params }: Props) {
  const { auctionId } = await params;
  const buyer = await requireBuyer();
  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, buyerId: buyer.id },
    // QUALIFIED, not merely SUBMITTED. The headline count, the close notification and the email
    // all have to be the same number: `status: "SUBMITTED"` alone counts a §13-D40 over-ceiling
    // offer and a lapsed one, so a buyer read "Your 2 Offers" over a report that ranked one — and
    // clicking the second was refused with OFFER_DISQUALIFIED by the select route.
    include: { _count: { select: { offers: { where: qualifiedOfferWhere() } } } },
  });
  if (!auction) notFound();
  if (auction.status !== "CLOSED") {
    return (
      <div className="p-8 text-center text-slate-500" data-testid="offers-not-ready">
        <p>Offers are available after your auction closes.</p>
      </div>
    );
  }

  const offerCount = auction._count.offers;

  // §23.2a TOUCHPOINT 2 (parity row C11) — the second Premium mention, on the report itself.
  //
  // Decided SERVER-SIDE and gated by the whole §23.2b suppression set, including PAY-73's open
  // exception, so a buyer with a dispute on their $99 or a case being worked on their transaction
  // never sees an ask for more money next to their offers. A failure to decide shows nothing: the
  // ask is never urgent, and §23.2b's "the in-app option remains available without further
  // prompting" means the dashboard link is still there either way.
  const premium = await resolveReportMention(auction.vehicleRequestId, buyer.id);

  return (
    <div className="p-6 md:p-8" data-testid="auction-offers-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Your {offerCount} Offer{offerCount !== 1 ? "s" : ""}</h1>
        <p className="text-sm text-slate-500 mt-1">Compare your ranked offers. Dealer identity is revealed after selection.</p>
      </div>
      {premium && <PremiumReportMention balanceDueUsd={premium.balanceDueUsd} />}
      <OfferComparisonPanel auctionId={auctionId} />
    </div>
  );
}

/**
 * May this buyer be shown the report's Premium mention, and at what price?
 *
 * Records the IMPRESSION when the answer is yes — §23.2a counts impressions per touchpoint, and
 * `recordImpression` is a no-op after the first, so a buyer who reloads the report is counted once
 * rather than once per visit.
 */
async function resolveReportMention(
  vehicleRequestId: string | null,
  buyerId: string,
): Promise<{ balanceDueUsd: string } | null> {
  if (!vehicleRequestId) return null;
  try {
    const counts = await upgradeAskCounts(buyerId, vehicleRequestId);
    const decision = await isUpgradePromptSuppressed({
      vehicleRequestId,
      buyerId,
      touchpoint: UPGRADE_TOUCHPOINTS.BEST_PRICE_REPORT,
      emailsSent: counts.emailsSent,
      declines: counts.declines,
    });
    if (decision.suppressed) return null;

    const quote = await quotePremiumBalance(vehicleRequestId);
    await recordImpression({
      buyerId,
      vehicleRequestId,
      touchpoint: UPGRADE_TOUCHPOINTS.BEST_PRICE_REPORT,
    });
    return { balanceDueUsd: `$${(quote.dueCents / 100).toLocaleString()}` };
  } catch {
    // A prompt is never urgent; the report is. Nothing here may keep a buyer from their offers.
    return null;
  }
}
