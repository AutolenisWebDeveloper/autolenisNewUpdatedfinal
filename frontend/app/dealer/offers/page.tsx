import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { FileText } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DealerOffersPage() {
  const dealer = await requireDealer();
  const offers = await prisma.offer.findMany({
    where: { dealerId: dealer.id },
    include: { auction: true },
    orderBy: { createdAt: "desc" },
  });

  const statusVariant: Record<string, "green" | "blue" | "gray" | "amber" | "destructive"> = {
    ACCEPTED: "green", SUBMITTED: "blue", DRAFT: "amber", DECLINED: "gray", WITHDRAWN: "gray",
  };

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-offers-page">
      <div className="flex items-center gap-3 mb-6">
        <FileText size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">My Offers</h1>
        <Badge variant="secondary">{offers.length}</Badge>
      </div>
      {offers.length === 0 ? (
        <div className="text-center py-20 text-slate-400" data-testid="no-offers">
          <p>No offers submitted yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {offers.map(offer => (
            <Link key={offer.id} href={`/dealer/offers/${offer.id}`} data-testid={`offer-item-${offer.id}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-[#0B5FD1]/30 transition-colors">
              <div className="flex items-center gap-3">
                <Badge variant={statusVariant[offer.status] ?? "gray"} className="text-xs">{offer.status}</Badge>
                <span className="font-semibold text-slate-900 text-sm">${(offer.otdPriceCents / 100).toLocaleString()}</span>
              </div>
              <span className="text-xs text-slate-400">{offer.createdAt.toLocaleDateString()}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
