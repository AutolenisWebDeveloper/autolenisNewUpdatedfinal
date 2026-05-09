import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { FileText, PenLine, MapPin, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function AdminDealsPage() {
  await requireAdmin();

  let deals: Awaited<ReturnType<typeof prisma.deal.findMany<{ include: { buyer: true; offer: { include: { dealer: { select: { dealershipName: true } } } } } }>>> = [];
  let loadError: string | null = null;

  try {
    deals = await prisma.deal.findMany({
      include: { buyer: true, offer: { include: { dealer: { select: { dealershipName: true } } } } },
      orderBy: { createdAt: "desc" }, take: 50,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading deals";
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-deals-page">
      <div className="flex items-center gap-3 mb-6"><FileText size={22} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">Deals <span className="text-slate-400 font-normal text-sm">({deals.length})</span></h1></div>
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-2 text-red-700" data-testid="deals-load-error">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load deals</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}
      {!loadError && deals.length === 0 && (
        <div className="text-center py-12 text-slate-400" data-testid="no-deals">No deals found</div>
      )}
      <div className="space-y-2">
        {deals.map(d => (
          <div key={d.id} data-testid={`deal-row-${d.id}`}
            className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
            <div>
              <p className="font-semibold text-slate-900 text-sm">{d.buyer?.firstName ?? ""} {d.buyer?.lastName ?? ""} — {d.offer?.dealer?.dealershipName ?? "Unknown Dealer"}</p>
              <p className="text-xs text-slate-400">${((d.offer?.otdPriceCents ?? 0) / 100).toLocaleString()} · {d.createdAt.toLocaleDateString()}</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={d.status === "COMPLETED" ? "green" : "secondary"} className="text-xs">{d.status.replace(/_/g, " ")}</Badge>
              <Link href={`/admin/deals/${d.id}/esign`} className="p-1.5 text-slate-400 hover:text-[#0B5FD1]" data-testid={`deal-esign-${d.id}`}><PenLine size={14} /></Link>
              <Link href={`/admin/deals/${d.id}/pickup`} className="p-1.5 text-slate-400 hover:text-[#0B5FD1]" data-testid={`deal-pickup-${d.id}`}><MapPin size={14} /></Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
