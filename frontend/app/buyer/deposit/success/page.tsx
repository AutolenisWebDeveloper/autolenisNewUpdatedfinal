import { logger } from "@/lib/logger";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Auction Access Fee Confirmed", robots: { index: false, follow: false } };

import Link from "next/link";
import { CheckCircle2, XCircle, ArrowRight, Clock } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { retrievePaymentIntent } from "@/lib/services/payment/stripe.service";
import { requireBuyer } from "@/lib/auth/session";
import ContentConversionTracker from "@/components/analytics/ContentConversionTracker";

export const dynamic = "force-dynamic";

interface Props { searchParams: Promise<Record<string, string>> }

export default async function DepositSuccessPage({ searchParams }: Props) {
  const params   = await searchParams;
  const intentId = params.payment_intent ?? null;
  const buyer    = await requireBuyer();

  let verified  = false;
  let pending   = false;
  let errorMsg: string | null = null;
  let conversionValueCents: number | undefined;

  if (intentId) {
    try {
      const intent = await retrievePaymentIntent(intentId);
      if (intent.status === "succeeded") {
        const deposit = await prisma.deposit.findFirst({
          where: { stripePaymentIntentId: intentId, buyerId: buyer.id },
          select: { id: true, status: true, amountCents: true },
        });
        if (deposit?.status === "PAID") {
          verified = true;
          conversionValueCents = deposit.amountCents;
        } else if (deposit) {
          pending = true;
        } else {
          errorMsg = "Payment received but auction setup is still processing.";
        }
      } else if (intent.status === "processing") {
        pending = true;
      } else {
        errorMsg = `Payment status: ${intent.status}. Return to payment and try again.`;
      }
    } catch (err) {
      logger.error("[deposit-success] verify error:", err);
      errorMsg = "Could not verify payment status. Contact support if charged.";
    }
  } else {
    errorMsg = "No payment reference found. Complete the payment flow.";
  }

  if (pending) {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="deposit-processing-page">
        <div className="w-20 h-20 rounded-full bg-[#EFF6FF] border border-[#DBEAFE] flex items-center justify-center mx-auto mb-5">
          <Clock size={40} className="text-[#0B5FD1]" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Payment processing…</h1>
        <p className="text-[#4B5563] text-sm mb-6 leading-relaxed">
          Your payment is being confirmed. This usually takes a few seconds.
          Refresh this page or check your auctions page in a moment.
        </p>
        <Link href="/buyer/auctions"
          className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors">
          Go to My Auctions <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  if (!verified) {
    return (
      <div className="p-6 md:p-8 max-w-xl text-center" data-testid="deposit-failed-page">
        <div className="w-20 h-20 rounded-full bg-red-50 border border-red-200 flex items-center justify-center mx-auto mb-5">
          <XCircle size={40} className="text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-[#111827] mb-2">Payment not confirmed</h1>
        <p className="text-[#4B5563] text-sm mb-8 leading-relaxed">{errorMsg}</p>
        <Link href="/buyer/deposit"
          className="inline-flex items-center gap-2 px-8 py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors">
          Return to Payment <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 md:p-8 max-w-xl text-center" data-testid="deposit-success-page">
      <ContentConversionTracker conversionType="deposit_paid" valueCents={conversionValueCents} />
      <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
        <CheckCircle2 size={40} className="text-green-600" />
      </div>
      <h1 className="text-2xl font-bold text-[#111827] mb-2">Auction activated!</h1>
      <p className="text-[#4B5563] text-sm mb-8 leading-relaxed">
        Your $99 Limited-Time Auction Access Fee was received. Your private 48-hour dealer competition is being prepared.
      </p>
      <div className="bg-[#EFF6FF] border border-[#DBEAFE] rounded-xl p-5 mb-6 text-left text-sm text-[#374151] space-y-2">
        <p>• Dealers will receive invitations within the next few minutes</p>
        <p>• Your 48-hour auction window starts now</p>
        <p>• You will be notified when offers arrive</p>
        <p>• Your $99 is fully refundable if no competitive offers are submitted</p>
      </div>
      <Link href="/buyer/auctions" data-testid="view-auction-btn"
        className="inline-flex items-center justify-center gap-2 w-full py-4 bg-[#0B5FD1] text-white font-semibold text-sm rounded-xl hover:bg-[#0A4DB8] transition-colors">
        View My Auction <ArrowRight size={15} />
      </Link>
    </div>
  );
}
