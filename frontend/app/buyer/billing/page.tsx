import type { Metadata } from "next";

export const metadata: Metadata = { title: "Billing" };

// Buyer billing page — shows deposit status, plan, and payment history.

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { CreditCard, CheckCircle, Clock, RefreshCw, ShieldCheck } from "lucide-react";
import { DEPOSIT_AMOUNT_CENTS } from "@/lib/constants";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

const STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  REFUNDED: "bg-gray-100 text-gray-700",
};

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

export default async function BillingPage() {
  const buyer = await requireBuyer();

  const deposits = await prisma.deposit.findMany({
    where: { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const deals = await prisma.deal.findMany({
    where:   { buyerId: buyer.id },
    orderBy: { createdAt: "desc" },
    select: {
      id:             true,
      stripeFeePIId:  true,
      feePaidAt:      true,
      feeAmountCents: true,
      status:         true,
    },
  });

  const hasPaidDeposit = deposits.some((d) => d.status === "PAID");
  const paidDeals = deals.filter(d => d.stripeFeePIId);

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Billing</h1>
        <p className="text-sm text-gray-500 mt-1">Your plan, deposit status, and payment history.</p>
      </div>

      {/* Plan */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-[#0B5FD1]" />
          Current Plan
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-[#0B5FD1]">
            {buyer.plan === "PREMIUM" ? "Premium Concierge" : "Standard"}
          </span>
          {buyer.plan === "PREMIUM" && (
            <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-[#EFF6FF] text-[#0B5FD1]">
              Premium
            </span>
          )}
        </div>
        {buyer.plan === "STANDARD" && (
          <p className="text-sm text-gray-500">
            Upgrade to Premium for full concierge service, priority dealer access, and expert negotiation.{" "}
            <Link href="/buyer/settings" className="text-[#0B5FD1] hover:underline">
              Learn more
            </Link>
          </p>
        )}
      </div>

      {/* Deposit */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[#0B5FD1]" />
          Auction Deposit
        </h2>

        {deposits.length === 0 ? (
          <div className="text-center py-6 space-y-3">
            <Clock className="h-10 w-10 text-gray-300 mx-auto" />
            <p className="text-gray-500 text-sm">No deposit on file.</p>
            <Link
              href="/buyer/deposit"
              className="inline-block bg-[#0B5FD1] text-white text-sm font-semibold px-5 py-2.5 rounded-lg hover:bg-[#0A4DB8] transition"
            >
              Activate My Auction — {formatCurrency(DEPOSIT_AMOUNT_CENTS)}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {deposits.map((deposit) => (
              <div key={deposit.id} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium text-gray-900">
                    Refundable Deposit — {formatCurrency(deposit.amountCents)}
                  </p>
                  <p className="text-xs text-gray-400">{formatDate(deposit.createdAt)}</p>
                </div>
                <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${STATUS_COLORS[deposit.status] ?? "bg-blue-100 text-blue-700"}`}>
                  {STATUS_LABELS[deposit.status] ?? deposit.status}
                </span>
              </div>
            ))}
            {hasPaidDeposit && (
              <div className="flex items-start gap-2 pt-2 text-sm text-green-700">
                <CheckCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>Your deposit is on file. It will be refunded if no deal is completed.</span>
              </div>
            )}
            {!hasPaidDeposit && deposits.some((d) => d.status === "REFUNDED") && (
              <div className="flex items-start gap-2 pt-2 text-sm text-gray-600">
                <RefreshCw className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  Your previous deposit was refunded.{" "}
                  <Link href="/buyer/deposit" className="text-[#0B5FD1] hover:underline">
                    Activate a new auction
                  </Link>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Concierge Fee History */}
      {paidDeals.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
          <h2 className="font-semibold text-gray-900 text-base">Concierge Fee History</h2>
          <div className="space-y-3">
            {paidDeals.map(d => (
              <div key={d.id}
                className="flex items-center justify-between border-b border-gray-100 last:border-0 py-3">
                <div>
                  <p className="text-sm font-semibold text-[#111827]">
                    Concierge Fee — Deal #{d.id.slice(-8).toUpperCase()}
                  </p>
                  {d.feePaidAt && (
                    <p className="text-xs text-[#6B7280] mt-0.5">
                      Paid {d.feePaidAt.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-[#111827]">
                    ${((d.feeAmountCents ?? 0) / 100).toFixed(0)}
                  </span>
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    d.feePaidAt ? "bg-[#ECFDF5] text-[#065F46]" : "bg-[#FFFBEB] text-amber-800"
                  }`}>
                    {d.feePaidAt ? "Paid" : "Pending"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        Questions about billing?{" "}
        <a href="mailto:support@autolenis.com" className="text-[#0B5FD1] hover:underline">
          Contact support
        </a>
      </p>
    </div>
  );
}
