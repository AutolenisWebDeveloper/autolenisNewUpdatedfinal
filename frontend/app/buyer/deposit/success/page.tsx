import { logger } from "@/lib/logger";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Auction Access Deposit Confirmed", robots: { index: false, follow: false } };

import Link from "next/link";
import { CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { retrievePaymentIntent } from "@/lib/services/payment/stripe.service";
import {
  classifyPaymentConfirmation,
  mayClaimActivation,
  type PaymentConfirmationOutcome,
} from "@/lib/services/payment/payment-confirmation";
import { requireBuyer } from "@/lib/auth/session";
import ContentConversionTracker from "@/components/analytics/ContentConversionTracker";
import PaymentUnsettledNotice from "@/components/buyer/PaymentUnsettledNotice";

export const dynamic = "force-dynamic";

interface Props { searchParams: Promise<Record<string, string>> }

/**
 * §23.2a touchpoint 1, for the sourcing-started screen.
 *
 * Returns null — no line at all — whenever §23.2b suppresses the ask or the buyer has no
 * open request to price against. Never a greyed-out or generic line: "named, not pushed"
 * means the absence of an ask is a legitimate outcome, not a degraded one.
 *
 * Best-effort. A page that renders the payment outcome must not fail because an upsell
 * could not be priced.
 */
async function composePremiumLine(buyerId: string): Promise<string | null> {
  try {
    const { findOpenRequest } = await import("@/lib/services/vehicle-request/open-request.service");
    const request = await findOpenRequest(buyerId);
    if (!request) return null;

    const { isUpgradePromptSuppressed, UPGRADE_TOUCHPOINTS } = await import(
      "@/lib/services/plan/upgrade-suppression.service"
    );
    const decision = await isUpgradePromptSuppressed({
      vehicleRequestId: request.id,
      buyerId,
      touchpoint: UPGRADE_TOUCHPOINTS.RECEIPT,
    });
    if (decision.suppressed) return null;

    const { quotePremiumBalance } = await import("@/lib/services/plan/upgrade-window.service");
    const quote = await quotePremiumBalance(request.id);
    return (
      `Premium adds a named concierge who coordinates the rest of your purchase — ` +
      `$${(quote.grossCents / 100).toFixed(0)} in total` +
      (quote.creditCents > 0
        ? `, less the $${(quote.creditCents / 100).toFixed(0)} you just paid, so $${(quote.dueCents / 100).toFixed(0)}.`
        : `.`) +
      ` Available whenever you want it — there is nothing to decide now.`
    );
  } catch {
    return null;
  }
}

export default async function DepositSuccessPage({ searchParams }: Props) {
  const params   = await searchParams;
  const intentId = params.payment_intent ?? null;
  const buyer    = await requireBuyer();

  let outcome: PaymentConfirmationOutcome = "unknown";
  let errorMsg: string | null = null;
  let conversionValueCents: number | undefined;
  // Concierge deposits unlock an admin-curated set of offers; they do NOT launch
  // a live reverse auction and no dealers are invited. The authoritative signal
  // is the same one the Stripe webhook branches on — pi.metadata.type — so the
  // copy below can never claim dealer competition for a concierge purchase.
  let isConcierge = false;
  let premiumLine: string | null = null;

  if (intentId) {
    try {
      const intent = await retrievePaymentIntent(intentId);
      isConcierge = intent.metadata?.type === "concierge_deposit";
      const deposit =
        intent.status === "succeeded"
          ? await prisma.deposit.findFirst({
              where: { stripePaymentIntentId: intentId, buyerId: buyer.id },
              select: { id: true, status: true, amountCents: true },
            })
          : null;

      // The claim is decided by the shared pure rule, never inline here, so this
      // page cannot drift back into asserting more than the facts support.
      outcome = classifyPaymentConfirmation({
        intentStatus: intent.status,
        recordedStatus: deposit?.status ?? null,
      });

      if (mayClaimActivation(outcome)) conversionValueCents = deposit?.amountCents;

      // §23.2a TOUCHPOINT 1 — the other half of "a single line on the receipt AND the
      // sourcing-started screen". The receipt carries it from the Stripe webhook; this
      // is the screen.
      //
      // Only where activation may be claimed. Showing a buyer an upsell on a page that
      // is telling them their payment is still settling is exactly §23.2b's "never sold
      // into a stall AutoLenis caused", one page earlier.
      if (mayClaimActivation(outcome) && !isConcierge) {
        premiumLine = await composePremiumLine(buyer.id);
      }
      if (outcome === "failed") {
        errorMsg = `Payment status: ${intent.status}. Return to payment and try again.`;
      }
    } catch (err) {
      logger.error("[deposit-success] verify error:", err);
      outcome = "unknown";
      errorMsg = "Could not verify payment status. Contact support if charged.";
    }
  } else {
    outcome = "unknown";
    errorMsg = "No payment reference found. Complete the payment flow.";
  }

  const pending = outcome === "processing";
  const chargedUnsettled = outcome === "charged_unsettled";
  const verified = mayClaimActivation(outcome);

  // "Check again" must carry the payment reference forward — dropping it would
  // land the buyer on "No payment reference found" after a charge succeeded.
  const recheckHref = intentId
    ? `/buyer/deposit/success?payment_intent=${encodeURIComponent(intentId)}`
    : "/buyer/deposit/success";

  // Both of these are rendered by the shared notice so that this page and
  // /buyer/deposit cannot drift apart on the one sentence that matters here:
  // "do not pay again".
  if (pending) {
    return (
      <PaymentUnsettledNotice
        variant="processing"
        paymentIntentId={intentId}
        recheckHref={recheckHref}
        isConcierge={isConcierge}
        testId="deposit-processing-page"
      />
    );
  }

  if (chargedUnsettled) {
    return (
      <PaymentUnsettledNotice
        variant="charged"
        paymentIntentId={intentId}
        recheckHref={recheckHref}
        isConcierge={isConcierge}
        testId="deposit-charged-unsettled-page"
      />
    );
  }

  if (!verified) {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="deposit-failed-page">
        <div className="w-20 h-20 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-5">
          <XCircle size={40} className="text-red-500" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Payment not confirmed</h1>
        <p className="text-[#4B5563] text-sm mb-8 leading-relaxed">{errorMsg}</p>
        <Link href="/buyer/deposit"
          className="inline-flex items-center gap-2 px-8 py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors">
          Return to Payment <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl text-center" data-testid="deposit-success-page">
      <ContentConversionTracker conversionType="deposit_paid" valueCents={conversionValueCents} />
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={40} className="text-green-600" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-[#111827] mb-2">
        {isConcierge ? "Deposit received!" : "Auction activated!"}
      </h1>
      <p className="text-[#4B5563] text-sm mb-8 leading-relaxed">
        {isConcierge
          ? "Your $99 Auction Access Deposit was received. The offers we prepared for you are being unlocked."
          : "Your $99 Limited-Time Auction Access Deposit was received. Your private 48-hour dealer competition is being prepared."}
      </p>
      <div className="bg-al-primary-subtle border border-[#DBEAFE] rounded-xl p-5 mb-6 text-left text-sm text-[#374151] space-y-2">
        {isConcierge ? (
          <>
            <p>• Your prepared offers are being made available to review</p>
            <p>• You will be notified as soon as they are ready</p>
            <p>• No dealers are being invited to bid — these offers are already sourced</p>
            <p>• If none of them work for you, you can request a refund of your $99 — our team reviews every request</p>
          </>
        ) : (
          <>
            <p>• Dealers will receive invitations within the next few minutes</p>
            <p>• Your 48-hour auction window starts now</p>
            <p>• You will be notified when offers arrive</p>
            <p>• If no competitive offer is received, you can request a refund of your $99 — our team reviews every request</p>
          </>
        )}
      </div>
      {premiumLine && (
        <p className="text-xs text-[#6B7280] mb-6 leading-relaxed text-left" data-testid="deposit-premium-line">
          {premiumLine}
        </p>
      )}
      <Link href="/buyer/auctions" data-testid="view-auction-btn"
        className="inline-flex items-center justify-center gap-2 w-full py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors">
        {isConcierge ? "View My Offers" : "View My Auction"} <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}
