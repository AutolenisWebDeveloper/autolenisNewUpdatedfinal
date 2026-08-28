import { logger } from "@/lib/logger";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Auction Access Deposit Confirmed", robots: { index: false, follow: false } };

import Link from "next/link";
import { CheckCircle2, XCircle, ArrowRight, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { retrievePaymentIntent } from "@/lib/services/payment/stripe.service";
import {
  classifyPaymentConfirmation,
  mayClaimActivation,
  type PaymentConfirmationOutcome,
} from "@/lib/services/payment/payment-confirmation";
import { requireBuyer } from "@/lib/auth/session";
import ContentConversionTracker from "@/components/analytics/ContentConversionTracker";

export const dynamic = "force-dynamic";

interface Props { searchParams: Promise<Record<string, string>> }

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

  if (pending) {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="deposit-processing-page">
        <div className="w-20 h-20 rounded-full bg-al-primary-subtle border border-[#DBEAFE] flex items-center justify-center mx-auto mb-5">
          <Clock size={40} className="text-al-primary" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Payment processing…</h1>
        <p className="text-[#4B5563] text-sm mb-6 leading-relaxed">
          Your bank is still confirming this payment. This usually takes a few
          seconds. Refresh this page in a moment — you do not need to pay again.
        </p>
        <Link href={recheckHref}
          className="inline-flex items-center gap-2 px-8 py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors">
          Check again <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  if (chargedUnsettled) {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="deposit-charged-unsettled-page">
        <div className="w-20 h-20 rounded-full bg-[#FFFBEB] border border-[#FDE68A] flex items-center justify-center mx-auto mb-5">
          <Clock size={40} className="text-al-warning" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Payment received — finishing setup</h1>
        <p className="text-[#4B5563] text-sm mb-6 leading-relaxed">
          Your $99 payment went through. We haven&apos;t finished recording it on
          our side yet, so {isConcierge ? "your offers are not unlocked" : "your auction is not live"} just
          this moment. <strong className="text-[#111827]">Do not pay again.</strong> This
          usually resolves on its own within a few minutes.
        </p>
        <div className="bg-[#F8F9FB] border border-[#E5E7EB] rounded-xl p-4 mb-6 text-left text-sm text-[#4B5563]">
          <p className="mb-1">
            Payment reference: <span className="font-mono text-xs text-[#111827]">{intentId}</span>
          </p>
          <p>
            If this page still says the same thing in 15 minutes, send that
            reference to{" "}
            <a href="mailto:support@autolenis.com" className="text-al-primary hover:underline">
              support@autolenis.com
            </a>{" "}
            and we&apos;ll finish it for you.
          </p>
        </div>
        <Link href={recheckHref}
          className="inline-flex items-center gap-2 px-8 py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors">
          Check again <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
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
      <Link href="/buyer/auctions" data-testid="view-auction-btn"
        className="inline-flex items-center justify-center gap-2 w-full py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors">
        {isConcierge ? "View My Offers" : "View My Auction"} <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}
