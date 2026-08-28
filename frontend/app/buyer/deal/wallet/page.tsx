import type { Metadata } from "next";

export const metadata: Metadata = { title: "Wallet", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PREMIUM_FEE_REMAINING_CENTS } from "@/lib/constants";
import { Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DealWalletPage() {
  const buyer = await requireBuyer();
  // The deposit line used to be printed from DEPOSIT_AMOUNT_CENTS with the
  // Deposit table never queried, so a buyer who had paid nothing still saw
  // "Auction Access Deposit paid +$99". Read the real record.
  const paidDeposit = await prisma.deposit.findFirst({
    where: { buyerId: buyer.id, status: "PAID" },
    orderBy: { createdAt: "desc" },
    select: { amountCents: true },
  });
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: {
      offer: true,
      vehicleRequestOffer: { select: { priceCents: true, vehicleInfo: true, notes: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="deal-wallet-page">
      <div className="flex items-center gap-3 mb-6">
        <Wallet size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Deal Financial Wallet</h1>
      </div>

      {!deal ? (
        <p className="text-slate-500 text-sm" data-testid="wallet-no-deal">No active deal.</p>
      ) : (
        <WalletBreakdown deal={deal} paidDepositCents={paidDeposit?.amountCents ?? null} />
      )}
    </div>
  );
}

function WalletBreakdown({ deal, paidDepositCents }: {
  deal: {
    feePaidAt: Date | null;
    feeAmountCents: number | null;
    offer: { otdPriceCents: number } | null;
    vehicleRequestOffer: { priceCents: number } | null;
  }
  /** Amount of the buyer's PAID deposit, or null when none is recorded. */
  paidDepositCents: number | null;
}) {
  const otdPriceCents = deal.offer?.otdPriceCents ?? deal.vehicleRequestOffer?.priceCents ?? 0;
  const depositPaidCents = paidDepositCents ?? 0;
  // The deposit is only credited against the fee once BOTH are actually paid.
  const depositCreditCents = deal.feePaidAt && paidDepositCents !== null ? depositPaidCents : 0;

  const items = [
    { label: "Vehicle out-the-door price", amount: otdPriceCents, positive: false },
    // Only claimed when a PAID deposit exists.
    { label: "Auction Access Deposit paid", amount: depositPaidCents, positive: true },
    // Service fee shown GROSS (= net charge + the deposit credit) so the credit
    // line below explains the net. feeAmountCents itself is the net charge.
    { label: "Service fee", amount: deal.feePaidAt ? (deal.feeAmountCents ?? PREMIUM_FEE_REMAINING_CENTS) + depositCreditCents : 0, positive: false },
    { label: "Net Auction Access Deposit credit", amount: depositCreditCents, positive: true },
  ];

  return (
    <div className="space-y-3" data-testid="wallet-breakdown">
      {items.map((item, i) => (
        <div key={i} data-testid={`wallet-item-${i}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-3">
          <span className="text-sm text-slate-600">{item.label}</span>
          <span className={`font-semibold text-sm ${item.positive ? "text-green-600" : "text-slate-900"}`}>
            {item.positive ? "+" : ""}{item.amount > 0 ? `$${(item.amount / 100).toLocaleString()}` : "—"}
          </span>
        </div>
      ))}

      <div className="flex items-center justify-between bg-al-primary/5 border border-al-primary/20 rounded-xl px-4 py-4 mt-4" data-testid="wallet-total">
        <span className="font-semibold text-slate-800">Total vehicle cost</span>
        <span className="font-bold text-al-primary text-lg">
          ${((otdPriceCents + (deal.feePaidAt ? deal.feeAmountCents ?? 0 : 0)) / 100).toLocaleString()}
        </span>
      </div>
    </div>
  );
}
