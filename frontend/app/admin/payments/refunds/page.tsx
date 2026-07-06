// /admin/payments/refunds — Combined refunds list (deposits + concierge fees)
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Refunds — Admin",
};

function fmtDate(d: Date | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

interface RefundRow {
  id: string;
  type: "DEPOSIT" | "CONCIERGE_FEE";
  buyerId: string;
  buyerName: string;
  buyerEmail: string;
  amountCents: number;
  refundedAt: Date;
  stripeRef: string | null;
  dealId?: string;
}

export default async function AdminRefundsPage() {
  await requireAdmin();

  // Refunded deposits
  const depositRefunds = await prisma.deposit.findMany({
    where: { OR: [{ status: "REFUNDED" }, { refundedAt: { not: null } }] },
    include: { buyer: { include: { user: { select: { email: true } } } } },
    orderBy: { refundedAt: "desc" },
    take: 200,
  });

  // Refunded concierge fees (Deal.feeRefundedAt set)
  const feeRefunds = await prisma.deal.findMany({
    where: { feeRefundedAt: { not: null } },
    include: { buyer: { include: { user: { select: { email: true } } } } },
    orderBy: { feeRefundedAt: "desc" },
    take: 200,
  });

  const rows: RefundRow[] = [
    ...depositRefunds
      .filter((d) => d.refundedAt)
      .map<RefundRow>((d) => ({
        id: d.id,
        type: "DEPOSIT",
        buyerId: d.buyerId,
        buyerName: `${d.buyer.firstName} ${d.buyer.lastName}`,
        buyerEmail: d.buyer.user.email,
        amountCents: d.amountCents,
        refundedAt: d.refundedAt!,
        stripeRef: d.stripePaymentIntentId,
      })),
    ...feeRefunds.map<RefundRow>((d) => ({
      id: d.id,
      type: "CONCIERGE_FEE",
      buyerId: d.buyerId,
      buyerName: `${d.buyer.firstName} ${d.buyer.lastName}`,
      buyerEmail: d.buyer.user.email,
      amountCents: d.feeRefundedAmountCents ?? d.feeAmountCents ?? 0,
      refundedAt: d.feeRefundedAt!,
      stripeRef: d.stripeFeePIId,
      dealId: d.id,
    })),
  ].sort((a, b) => b.refundedAt.getTime() - a.refundedAt.getTime());

  const totalRefundedCents = rows.reduce((sum, r) => sum + r.amountCents, 0);
  const depositRefundCount = rows.filter((r) => r.type === "DEPOSIT").length;
  const feeRefundCount = rows.filter((r) => r.type === "CONCIERGE_FEE").length;

  return (
    <div className="p-6 md:p-8 max-w-7xl" data-testid="admin-refunds-page">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Refunds</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {rows.length} total · {depositRefundCount} deposit{depositRefundCount !== 1 ? "s" : ""} ·{" "}
            {feeRefundCount} concierge fee{feeRefundCount !== 1 ? "s" : ""} ·{" "}
            {fmtCents(totalRefundedCents)} refunded
          </p>
        </div>
        <Link
          href="/admin/payments"
          className="text-xs text-slate-500 hover:text-al-primary hover:underline"
          data-testid="refunds-back-to-payments"
        >
          ← Back to Payments
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm" data-testid="refunds-empty">
          No refunds on record.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="hidden md:grid grid-cols-[120px_1fr_1.5fr_100px_1fr_1.5fr] gap-3 px-5 py-3 bg-slate-50 border-b border-slate-100">
            {["Type", "Buyer", "Email", "Amount", "Refunded", "Stripe Ref"].map((h) => (
              <span key={h} className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide">
                {h}
              </span>
            ))}
          </div>
          {rows.map((r, i) => (
            <div
              key={`${r.type}-${r.id}`}
              className={`grid md:grid-cols-[120px_1fr_1.5fr_100px_1fr_1.5fr] gap-3 px-5 py-4 items-center ${
                i < rows.length - 1 ? "border-b border-slate-50" : ""
              } hover:bg-slate-50/60 transition-colors`}
              data-testid={`refund-row-${r.type.toLowerCase()}-${r.id}`}
            >
              <span
                className={`inline-flex px-2 py-0.5 rounded text-xs font-semibold border w-fit ${
                  r.type === "DEPOSIT"
                    ? "bg-blue-50 text-blue-700 border-blue-200"
                    : "bg-purple-50 text-purple-700 border-purple-200"
                }`}
              >
                {r.type === "DEPOSIT" ? "Deposit" : "Concierge"}
              </span>
              <Link
                href={`/admin/buyers/${r.buyerId}`}
                className="text-sm font-semibold text-slate-800 truncate hover:text-al-primary"
              >
                {r.buyerName}
              </Link>
              <span className="text-xs text-slate-500 truncate">{r.buyerEmail}</span>
              <span className="text-sm font-semibold text-slate-800">{fmtCents(r.amountCents)}</span>
              <span className="text-xs text-slate-500">{fmtDate(r.refundedAt)}</span>
              <span className="text-[11px] text-slate-400 font-mono truncate">
                {r.stripeRef ? `${r.stripeRef.slice(0, 22)}…` : "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
