import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { CreditCard } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageContainer, PageHeader, EmptyState, CARD } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Map a financing status onto a semantic Badge tone so APPROVED / PENDING /
// DECLINED read differently (they previously all rendered the same blue pill).
function statusVariant(status: string): "green" | "amber" | "destructive" | "secondary" {
  const u = status.toUpperCase();
  if (["APPROVED", "ACTIVE", "FUNDED", "COMPLETED"].includes(u)) return "green";
  if (["PENDING", "SUBMITTED", "IN_REVIEW", "PROCESSING"].includes(u)) return "amber";
  if (["DECLINED", "REJECTED", "CANCELLED"].includes(u)) return "destructive";
  return "secondary";
}

export default async function DealerFinancingPage() {
  const dealer = await requireDealer();

  // Find Financing rows where the buyer chose dealer financing on a deal owned by this dealer.
  const financings = await prisma.financing.findMany({
    where: {
      path: "DEALER",
      deal: {
        status: { notIn: ["CANCELLED", "REFUNDED"] },
        offer: { dealerId: dealer.id },
      },
    },
    include: {
      deal: {
        include: {
          buyer: { include: { user: { select: { email: true } } } },
          offer: { select: { aprRate: true, termMonths: true, otdPriceCents: true } },
        },
      },
    },
    orderBy: { selectedAt: "desc" },
    take: 50,
  });

  return (
    <PageContainer testId="dealer-financing-page">
      <PageHeader
        title="Finance Manager"
        subtitle="Deals where the buyer chose dealer financing with you."
        actions={<Badge variant="secondary">{financings.length} active</Badge>}
      />

      {financings.length === 0 ? (
        <EmptyState
          icon={CreditCard}
          title="No active financing deals"
          body="Financing details appear here when buyers select dealer financing on their deals."
          testId="financing-empty"
        />
      ) : (
        <div className={cn(CARD, "overflow-x-auto")}>
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-slate-50 text-[11px] text-slate-400 uppercase tracking-[0.14em]">
              <tr>
                <th className="text-left px-5 py-3 font-semibold">Buyer</th>
                <th className="text-left px-5 py-3 font-semibold">APR</th>
                <th className="text-left px-5 py-3 font-semibold">Term</th>
                <th className="text-left px-5 py-3 font-semibold">Monthly</th>
                <th className="text-left px-5 py-3 font-semibold">Approved</th>
                <th className="text-left px-5 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {financings.map(f => {
                const apr = f.aprRate ?? f.deal.offer?.aprRate ?? null;
                const term = f.termMonths ?? f.deal.offer?.termMonths ?? null;
                const buyerName = [f.deal.buyer?.firstName, f.deal.buyer?.lastName]
                  .filter(Boolean).join(" ") || f.deal.buyer?.user?.email || "—";
                return (
                  <tr key={f.id} className="hover:bg-slate-50 transition-colors" data-testid={`financing-row-${f.id}`}>
                    <td className="px-5 py-3 text-slate-700">{buyerName}</td>
                    <td className="px-5 py-3 font-mono tabular-nums text-slate-900">
                      {apr !== null ? `${apr.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-700 tabular-nums">
                      {term !== null ? `${term} mo` : "—"}
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums text-slate-900">
                      {f.monthlyPaymentCents
                        ? `$${(f.monthlyPaymentCents / 100).toFixed(0)}/mo`
                        : "—"}
                    </td>
                    <td className="px-5 py-3 font-mono tabular-nums text-slate-700">
                      {f.approvedAmountCents
                        ? `$${(f.approvedAmountCents / 100).toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <Badge variant={statusVariant(f.status)} className="text-xs">
                        {f.status}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </PageContainer>
  );
}
