import type { Metadata } from "next";

export const metadata: Metadata = { title: "Wallet", robots: { index: false, follow: false } };

// Feature 16 — Deal Financial Wallet (read-only)
// DealWallet computes from existing deal and payment records — no new payment integration
// D16: Read-only component — never writes payment data

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PREMIUM_FEE_CENTS, DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";
import { Wallet } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DealWalletPage() {
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: { offer: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="deal-wallet-page">
      <div className="flex items-center gap-3 mb-6">
        <Wallet size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Deal Financial Wallet</h1>
      </div>

      {!deal ? (
        <p className="text-slate-500 text-sm" data-testid="wallet-no-deal">No active deal.</p>
      ) : (
        <div className="space-y-3" data-testid="wallet-breakdown">
          {[
            { label: "Vehicle out-the-door price", amount: deal.offer.otdPriceCents, positive: false },
            { label: "Deposit paid", amount: DEPOSIT_AMOUNT_CENTS, positive: true },
            { label: "Service fee", amount: deal.feePaidAt ? deal.feeAmountCents ?? PREMIUM_FEE_CENTS : 0, positive: false },
            { label: "Net deposit credit", amount: deal.feePaidAt ? DEPOSIT_AMOUNT_CENTS : 0, positive: true },
          ].map((item, i) => (
            <div key={i} data-testid={`wallet-item-${i}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-lg px-4 py-3">
              <span className="text-sm text-slate-600">{item.label}</span>
              <span className={`font-semibold text-sm ${item.positive ? "text-green-600" : "text-slate-900"}`}>
                {item.positive ? "+" : ""}{item.amount > 0 ? `$${(item.amount / 100).toLocaleString()}` : "—"}
              </span>
            </div>
          ))}

          <div className="flex items-center justify-between bg-[#0B5FD1]/5 border border-[#0B5FD1]/20 rounded-xl px-4 py-4 mt-4" data-testid="wallet-total">
            <span className="font-semibold text-slate-800">Total vehicle cost</span>
            <span className="font-bold text-[#0B5FD1] text-lg">
              ${((deal.offer.otdPriceCents + (deal.feeAmountCents ?? 0) - DEPOSIT_AMOUNT_CENTS) / 100).toLocaleString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
