import { requireAdmin } from "@/lib/auth/admin-session"; import { prisma } from "@/lib/prisma"; import { Badge } from "@/components/ui/badge"; import { DollarSign, AlertTriangle } from "lucide-react";
export const dynamic = "force-dynamic";
export default async function AdminOffersPage() {
  await requireAdmin();
  let offers: Awaited<ReturnType<typeof prisma.offer.findMany<{ include: { dealer: { select: { dealershipName: true } }; auction: { include: { buyer: { select: { firstName: true; lastName: true } } } } } }>>> = [];
  let loadError: string | null = null;
  try {
    offers = await prisma.offer.findMany({ include: { dealer: { select: { dealershipName: true } }, auction: { include: { buyer: { select: { firstName: true, lastName: true } } } } }, orderBy: { createdAt: "desc" }, take: 50 });
  } catch {
    loadError = "Offers could not be loaded. Retry, or check the database connection on System Health.";
  }
  return (<div className="p-6 md:p-8 max-w-5xl" data-testid="admin-offers-page"><div className="flex items-center gap-3 mb-6"><DollarSign size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">Offers ({offers.length})</h1></div>
    {loadError && (<div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-4 mb-4 text-red-700" data-testid="offers-load-error"><AlertTriangle size={16} className="mt-0.5 shrink-0" /><p className="text-sm">{loadError}</p></div>)}
    {!loadError && offers.length === 0 && (<div className="text-center py-16 text-slate-400 bg-white border border-slate-200 rounded-xl" data-testid="offers-empty"><p className="font-medium text-slate-500">No offers yet</p><p className="text-xs mt-1">Dealer offers appear here as auctions receive bids.</p></div>)}
    <div className="space-y-2">{offers.map(o => (<div key={o.id} data-testid={`offer-row-${o.id}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4"><div><p className="font-semibold text-slate-900 text-sm">${(o.otdPriceCents / 100).toLocaleString()} — {o.dealer.dealershipName}</p><p className="text-xs text-slate-400">{o.auction.buyer.firstName} {o.auction.buyer.lastName} · {o.createdAt.toLocaleDateString()}</p></div><Badge variant={o.status === "ACCEPTED" ? "green" : "secondary"} className="text-xs">{o.status}</Badge></div>))}</div></div>);
}
