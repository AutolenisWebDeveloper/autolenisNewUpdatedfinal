import { logger } from "@/lib/logger";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Service Fee Payment", robots: { index: false, follow: false } };

import Link from "next/link";
import { CheckCircle2, XCircle, ArrowRight, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { retrievePaymentIntent } from "@/lib/services/payment/stripe.service";
import { requireBuyer } from "@/lib/auth/session";
import {
  classifyPaymentConfirmation,
  mayClaimActivation,
  type PaymentConfirmationOutcome,
} from "@/lib/services/payment/payment-confirmation";

export const dynamic = "force-dynamic";

// Server-verified landing page for the concierge service fee.
//
// The fee form used to send the buyer back to /buyer/deal, which ignores the
// Stripe redirect parameters entirely and renders purely from the DB state that
// the (never-delivered) webhook would have written. After a real $400 charge the
// buyer therefore saw the fee still unpaid and the "Pay" CTA offered again —
// an invitation to be charged twice.
//
// This is the fee's equivalent of /buyer/deposit/success: it re-retrieves the
// PaymentIntent server-side, reads our own settlement record, and applies the
// SAME truthfulness rule both payments share (lib/services/payment/
// payment-confirmation) — optimism about the buyer's money is required,
// optimism about our fulfillment is forbidden.
interface Props { searchParams: Promise<Record<string, string>> }

export default async function DealPaymentSuccessPage({ searchParams }: Props) {
  const params = await searchParams;
  const intentId = params.payment_intent ?? null;
  const buyer = await requireBuyer();

  let outcome: PaymentConfirmationOutcome = "unknown";
  let errorMsg: string | null = null;

  if (intentId) {
    try {
      const intent = await retrievePaymentIntent(intentId);
      // Our settlement record for the fee: the deal's own feePaidAt stamp, or a
      // ServiceFeePayment row. Either is evidence; neither can be inferred.
      let recordedStatus: string | null = null;
      if (intent.status === "succeeded") {
        const deal = await prisma.deal.findFirst({
          where: { buyerId: buyer.id },
          orderBy: { createdAt: "desc" },
          select: { id: true, feePaidAt: true },
        });
        const feePayment = deal
          ? await prisma.serviceFeePayment.findUnique({
              where: { dealId: deal.id },
              select: { paidAt: true },
            })
          : null;
        recordedStatus = deal?.feePaidAt || feePayment?.paidAt ? "PAID" : null;
      }
      outcome = classifyPaymentConfirmation({ intentStatus: intent.status, recordedStatus });
      if (outcome === "failed") {
        errorMsg = `Payment status: ${intent.status}. Return to payment and try again.`;
      }
    } catch (err) {
      logger.error("[deal-payment-success] verify error:", err);
      outcome = "unknown";
      errorMsg = "Could not verify payment status. Contact support if charged.";
    }
  } else {
    errorMsg = "No payment reference found. Complete the payment flow.";
  }

  const recheckHref = intentId
    ? `/buyer/deal/payment/success?payment_intent=${encodeURIComponent(intentId)}`
    : "/buyer/deal/payment/success";

  if (outcome === "processing") {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="fee-processing-page">
        <div className="w-20 h-20 rounded-full bg-al-primary-subtle border border-[#DBEAFE] flex items-center justify-center mx-auto mb-5">
          <Clock size={40} className="text-al-primary" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Payment processing…</h1>
        <p className="text-[#4B5563] text-sm mb-6 leading-relaxed">
          Your bank is still confirming this payment. Refresh in a moment — you do
          not need to pay again.
        </p>
        <Link href={recheckHref}
          className="inline-flex items-center gap-2 px-8 py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors">
          Check again <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  if (outcome === "charged_unsettled") {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="fee-charged-unsettled-page">
        <div className="w-20 h-20 rounded-full bg-[#FFFBEB] border border-[#FDE68A] flex items-center justify-center mx-auto mb-5">
          <Clock size={40} className="text-al-warning" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Payment received — finishing up</h1>
        <p className="text-[#4B5563] text-sm mb-6 leading-relaxed">
          Your service fee payment went through. We haven&apos;t finished recording
          it on our side yet.{" "}
          <strong className="text-[#111827]">Do not pay again.</strong> This
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

  if (!mayClaimActivation(outcome)) {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="fee-failed-page">
        <div className="w-20 h-20 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-5">
          <XCircle size={40} className="text-red-500" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Payment not confirmed</h1>
        <p className="text-[#4B5563] text-sm mb-8 leading-relaxed">{errorMsg}</p>
        <Link href="/buyer/deal/payment"
          className="inline-flex items-center gap-2 px-8 py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors">
          Return to Payment <ArrowRight size={15} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl text-center" data-testid="fee-success-page">
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={40} className="text-green-600" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-[#111827] mb-2">Service fee paid</h1>
      <p className="text-[#4B5563] text-sm mb-8 leading-relaxed">
        Your AutoLenis service fee has been received. Your concierge team will
        take your deal from here.
      </p>
      <Link href="/buyer/deal" data-testid="fee-goto-deal-btn"
        className="inline-flex items-center justify-center gap-2 w-full py-4 bg-al-primary text-white font-semibold text-sm rounded-xl hover:bg-al-primary-hover transition-colors">
        Back to My Deal <ArrowRight size={15} aria-hidden="true" />
      </Link>
    </div>
  );
}
