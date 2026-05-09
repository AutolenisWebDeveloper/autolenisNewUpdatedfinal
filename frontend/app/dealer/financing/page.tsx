import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { CreditCard } from "lucide-react";

export const dynamic = "force-dynamic";

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
    <div className="p-6 md:p-8 max-w-4xl" data-testid="dealer-financing-page">
      <div className="flex items-center gap-3 mb-6">
        <CreditCard size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Finance Manager</h1>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#EFF6FF] text-[#0B5FD1]">
          {financings.length} active
        </span>
      </div>

      {financings.length === 0 ? (
        <div className="text-center py-12 bg-white border border-slate-200 rounded-2xl text-slate-400" data-testid="financing-empty">
          <CreditCard size={28} className="mx-auto mb-3 opacity-30" />
          <p className="font-medium text-slate-600 mb-1">No active financing deals</p>
          <p className="text-sm">Financing details appear here when buyers select dealer financing on their deals.</p>
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-5 py-3">Buyer</th>
                <th className="text-left px-5 py-3">APR</th>
                <th className="text-left px-5 py-3">Term</th>
                <th className="text-left px-5 py-3">Monthly</th>
                <th className="text-left px-5 py-3">Approved</th>
                <th className="text-left px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {financings.map(f => {
                const apr = f.aprRate ?? f.deal.offer?.aprRate ?? null;
                const term = f.termMonths ?? f.deal.offer?.termMonths ?? null;
                const buyerName = [f.deal.buyer?.firstName, f.deal.buyer?.lastName]
                  .filter(Boolean).join(" ") || f.deal.buyer?.user?.email || "—";
                return (
                  <tr key={f.id} className="hover:bg-[#F8FAFF]" data-testid={`financing-row-${f.id}`}>
                    <td className="px-5 py-3 text-slate-700">{buyerName}</td>
                    <td className="px-5 py-3 font-mono text-slate-900">
                      {apr !== null ? `${apr.toFixed(2)}%` : "—"}
                    </td>
                    <td className="px-5 py-3 text-slate-700">
                      {term !== null ? `${term} mo` : "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-900">
                      {f.monthlyPaymentCents
                        ? `$${(f.monthlyPaymentCents / 100).toFixed(0)}/mo`
                        : "—"}
                    </td>
                    <td className="px-5 py-3 font-mono text-slate-700">
                      {f.approvedAmountCents
                        ? `$${(f.approvedAmountCents / 100).toLocaleString()}`
                        : "—"}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#EFF6FF] text-[#0B5FD1]">
                        {f.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
