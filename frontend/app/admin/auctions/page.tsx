import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Gavel, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";
export default async function AdminAuctionsPage() {
  await requireAdmin();

  let auctions: Awaited<ReturnType<typeof prisma.auction.findMany<{ include: { buyer: true; _count: { select: { offers: true } } } }>>> = [];
  let loadError: string | null = null;

  try {
    auctions = await prisma.auction.findMany({
      include: { buyer: true, _count: { select: { offers: true } } },
      orderBy: { createdAt: "desc" }, take: 50,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading auctions";
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-auctions-page">
      <div className="flex items-center gap-3 mb-6"><Gavel size={22} className="text-[#0B5FD1]" /><h1 className="text-xl font-bold text-slate-900">Auctions <span className="text-slate-400 font-normal text-sm">({auctions.length})</span></h1></div>
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-2 text-red-700" data-testid="auctions-load-error">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load auctions</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}
      {!loadError && auctions.length === 0 && (
        <div className="text-center py-12 text-slate-400" data-testid="no-auctions">No auctions found</div>
      )}
      <div className="space-y-2">
        {auctions.map(a => (
          <Link key={a.id} href={`/admin/auctions/${a.id}`} data-testid={`auction-row-${a.id}`}
            className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-[#0B5FD1]/30 transition-colors">
            <div>
              <p className="font-semibold text-slate-900 text-sm">Auction #{a.id.slice(-8)}</p>
              <p className="text-xs text-slate-400">{a.buyer?.firstName ?? ""} {a.buyer?.lastName ?? ""} · {a._count.offers} offers</p>
            </div>
            <Badge variant={a.status === "ACTIVE" ? "green" : a.status === "CLOSED" ? "gray" : "amber"} className="text-xs">{a.status}</Badge>
          </Link>
        ))}
      </div>
    </div>
  );
}
