import type { Metadata } from "next";

export const metadata: Metadata = { title: "Payment", robots: { index: false, follow: false } };

import Link from "next/link";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { ArrowRight, Shield, Sparkles } from "lucide-react";
import { PREMIUM_FEE_CENTS, PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import FeePaymentForm from "@/components/buyer/FeePaymentForm";

export const dynamic = "force-dynamic";

export default async function DealPaymentPage() {
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: { offer: true },
    orderBy: { createdAt: "desc" },
  });

  if (!deal) return <div className="p-8 text-[#4B5563]" data-testid="payment-no-deal">No active deal.</div>;

  // The "$99 already credited" line used to be printed from the constant with no
  // deposit ever checked, so a buyer who never paid one was shown a credit they
  // had not earned. Read the real record and only claim the credit when it
  // exists. NOTE: the amount actually charged is decided server-side by
  // /api/buyer/deals/[dealId]/fee/create-intent and is unchanged here — this
  // only stops the page asserting a credit it cannot evidence.
  const paidDeposit = await prisma.deposit.findFirst({
    where: { buyerId: buyer.id, status: "PAID" },
    orderBy: { createdAt: "desc" },
    select: { amountCents: true },
  });
  const depositCreditCents = paidDeposit?.amountCents ?? 0;

  const isPremium = buyer.plan === "PREMIUM";

  // ─── STANDARD plan: no concierge fee ─────────────────────────────────────
  if (!isPremium) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="deal-payment-page">
        <h1 className="text-xl font-bold text-[#111827] mb-6">Service Fee</h1>

        <div
          className="bg-white border-2 border-[#50D14E]/30 rounded-xl p-6 mb-6"
          data-testid="standard-plan-no-fee"
        >
          <div className="flex items-start gap-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-[#50D14E]/15 flex items-center justify-center shrink-0">
              <Shield size={18} className="text-[#1A6B18]" />
            </div>
            <div>
              <p className="text-sm font-bold text-[#111827] mb-1">You are on the Standard plan.</p>
              <p className="text-sm text-[#4B5563] leading-relaxed">
                No service fee applies. If no valuable offer is received, you can request a refund of your $99 Limited-Time Auction Access Deposit — our team reviews every request.
              </p>
            </div>
          </div>

          <div className="border-t border-al-primary-subtle pt-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-[#4B5563]">AutoLenis Service Fee</span>
              <span className="font-semibold text-[#111827]">$0</span>
            </div>
            <div className="flex justify-between text-[#1A6B18]">
              <span>$99 Auction Access Deposit → refund available on request if no valuable offer</span>
              <span>Refund on request</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-al-primary-subtle pt-2">
              <span>Due to AutoLenis today</span>
              <span>$0.00</span>
            </div>
          </div>

          <p className="text-xs text-[#94A3B8] mt-4">
            Want the full white-glove experience? <Link href="/buyer/billing" className="text-al-primary hover:underline font-medium">Upgrade to Premium</Link>
          </p>
        </div>

        <Button className="w-full" size="lg" href="/buyer/insurance" data-testid="proceed-to-insurance-btn">
          Continue to Insurance <ArrowRight size={15} />
        </Button>
      </div>
    );
  }

  // ─── PREMIUM plan: $499 less $99 Auction Access Deposit credit = $400 due ───────────────
  const netFeeCents = PREMIUM_FEE_REMAINING_CENTS;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="deal-payment-page">
      <h1 className="text-xl font-bold text-[#111827] mb-6 flex items-center gap-2">
        <Sparkles size={18} className="text-al-primary" /> AutoLenis Service Fee
      </h1>

      <div className="bg-white border border-[#E5E7EB] rounded-xl p-6 mb-6">
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-[#4B5563]">
              {depositCreditCents > 0 ? "AutoLenis Service Fee (total)" : "AutoLenis Service Fee"}
            </span>
            <span className="font-semibold text-[#111827]">
              ${(depositCreditCents > 0 ? PREMIUM_FEE_CENTS : netFeeCents) / 100}
            </span>
          </div>
          {/* Only claimed when a PAID deposit actually exists — this line used
              to be printed from the constant with no deposit ever checked. */}
          {depositCreditCents > 0 && (
            <div className="flex justify-between text-[#1A6B18]">
              <span>${depositCreditCents / 100} Auction Access Deposit already credited</span>
              <span>-${depositCreditCents / 100}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-base border-t border-al-primary-subtle pt-3">
            <span>Due today</span>
            <span className="text-al-primary">${netFeeCents / 100}</span>
          </div>
        </div>
        <p className="text-xs text-[#4B5563] mt-4 bg-[#F8F9FB] border border-[#E5E7EB] rounded-md px-3 py-2 leading-relaxed">
          AutoLenis Service Fee: <span className="font-semibold">$499 total</span> — $99 Auction Access Deposit already credited = <span className="font-semibold">$400 due today</span>.
        </p>
      </div>

      {deal.feePaidAt ? (
        <div className="text-center py-6 text-[#1A6B18] font-semibold" data-testid="fee-already-paid">
          Fee paid ✓ — Continue to insurance
        </div>
      ) : (
        <FeePaymentForm dealId={deal.id} netFeeCents={netFeeCents} />
      )}
    </div>
  );
}
