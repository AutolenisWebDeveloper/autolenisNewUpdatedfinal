// /admin/payments/reconciliation — read-only money-state reconciliation.
// Surfaces mismatches between recorded money state and its payment reference
// trail (Stripe refs, settlement links). Never auto-resolves: every row is a
// human triage item with a deep link to the owning surface.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Scale, CheckCircle2, AlertTriangle } from "lucide-react";
import AutoRefresh from "@/components/admin/AutoRefresh";

export const dynamic = "force-dynamic";

interface Mismatch {
  id: string;
  kind: string;
  detail: string;
  href: string;
  severity: "high" | "medium";
}

export default async function AdminReconciliationPage() {
  await requireAdmin();

  const [depositsNoRef, depositsDrift, feesNoRef, commissionsPaidUnlinked, commissionsDrift] = await Promise.all([
    // Money state without a Stripe reference
    prisma.deposit.findMany({
      where: { status: { in: ["PAID", "REFUNDED"] }, stripePaymentIntentId: null },
      include: { buyer: { select: { firstName: true, lastName: true } } },
      take: 100,
    }),
    // refundedAt stamped but status not REFUNDED (state drift)
    prisma.deposit.findMany({
      where: { refundedAt: { not: null }, NOT: { status: "REFUNDED" } },
      include: { buyer: { select: { firstName: true, lastName: true } } },
      take: 100,
    }),
    // Premium fee recorded paid without a Stripe payment-intent ref
    prisma.deal.findMany({
      where: { feePaidAt: { not: null }, stripeFeePIId: null },
      include: { buyer: { select: { firstName: true, lastName: true } } },
      take: 100,
    }),
    // Commission PAID without the settlement link the mark-paid rail sets
    prisma.commission.findMany({
      where: { status: "PAID", OR: [{ payoutId: null }, { paidAt: null }] },
      take: 100,
    }),
    // paidAt stamped but status not PAID (REVERSED keeps its historical paidAt
    // legitimately — clawbacks are not drift)
    prisma.commission.findMany({
      where: { paidAt: { not: null }, NOT: { status: { in: ["PAID", "REVERSED"] } } },
      take: 100,
    }),
  ]);

  const mismatches: Mismatch[] = [
    ...depositsNoRef.map((d) => ({
      id: `dep-noref-${d.id}`,
      kind: `Deposit ${d.status} without Stripe ref`,
      detail: `${d.buyer.firstName} ${d.buyer.lastName} · $${(d.amountCents / 100).toLocaleString()} · ${d.createdAt.toLocaleDateString()}`,
      href: `/admin/payments/deposits`,
      severity: "high" as const,
    })),
    ...depositsDrift.map((d) => ({
      id: `dep-drift-${d.id}`,
      kind: `Deposit refund-stamped but status ${d.status}`,
      detail: `${d.buyer.firstName} ${d.buyer.lastName} · $${(d.amountCents / 100).toLocaleString()} · refunded ${d.refundedAt?.toLocaleDateString()}`,
      href: `/admin/payments/refunds`,
      severity: "high" as const,
    })),
    ...feesNoRef.map((d) => ({
      id: `fee-noref-${d.id}`,
      kind: "Premium fee paid without Stripe ref",
      detail: `${d.buyer.firstName} ${d.buyer.lastName} · deal …${d.id.slice(-8)} · paid ${d.feePaidAt?.toLocaleDateString()} (may be a manual mark-paid — verify in audit log)`,
      href: `/admin/deals/${d.id}`,
      severity: "medium" as const,
    })),
    ...commissionsPaidUnlinked.map((c) => ({
      id: `com-unlinked-${c.id}`,
      kind: "Commission PAID without settlement link",
      detail: `$${(c.amountCents / 100).toLocaleString()} · level ${c.level} · commission …${c.id.slice(-8)}`,
      href: `/admin/payments`,
      severity: "high" as const,
    })),
    ...commissionsDrift.map((c) => ({
      id: `com-drift-${c.id}`,
      kind: `Commission paid-stamped but status ${c.status}`,
      detail: `$${(c.amountCents / 100).toLocaleString()} · paid ${c.paidAt?.toLocaleDateString()} · commission …${c.id.slice(-8)}`,
      href: `/admin/payments`,
      severity: "high" as const,
    })),
  ];

  const high = mismatches.filter((m) => m.severity === "high");
  const medium = mismatches.filter((m) => m.severity === "medium");

  return (
    <div className="p-6 md:p-8 max-w-4xl" data-testid="admin-reconciliation-page">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <Scale size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">Payment Reconciliation</h1>
        </div>
        <AutoRefresh intervalMs={60_000} />
      </div>
      <p className="text-sm text-slate-500 mb-6">
        Recorded money state vs its payment-reference trail. Mismatches are surfaced for human triage —
        nothing here auto-resolves money. Resolve from the linked surface with the audit log open.
      </p>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {[
          { label: "High-severity mismatches", value: high.length, tone: high.length ? "text-red-600" : "text-green-600" },
          { label: "Review items", value: medium.length, tone: medium.length ? "text-amber-600" : "text-green-600" },
          { label: "Checks run", value: 5, tone: "text-slate-700" },
        ].map((s) => (
          <div key={s.label} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${s.tone}`}>{s.value}</p>
            <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {mismatches.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center gap-3" data-testid="reconciliation-clean">
          <CheckCircle2 size={18} className="text-green-600" aria-hidden />
          <p className="text-sm text-green-800 font-medium">
            All checks clean — every recorded payment state carries its expected reference.
          </p>
        </div>
      ) : (
        <div className="space-y-2" data-testid="reconciliation-mismatches">
          {mismatches.map((m) => (
            <Link
              key={m.id}
              href={m.href}
              className={`flex items-start justify-between gap-3 bg-white border rounded-xl px-5 py-3.5 hover:border-al-primary/40 transition-colors ${m.severity === "high" ? "border-red-200" : "border-amber-200"}`}
              data-testid={`mismatch-${m.id}`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle size={15} className={`mt-0.5 shrink-0 ${m.severity === "high" ? "text-red-500" : "text-amber-500"}`} aria-hidden />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">{m.kind}</p>
                  <p className="text-xs text-slate-500 truncate">{m.detail}</p>
                </div>
              </div>
              <span className="text-xs text-al-primary font-medium shrink-0">Triage →</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
