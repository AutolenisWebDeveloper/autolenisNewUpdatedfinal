import { requireDealer } from "@/lib/auth/dealer-session";
import { Users } from "lucide-react";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DealerLeadsPage() {
  const dealer = await requireDealer();
  // Leads = auction invitations with buyer context
  const leads = await prisma.auctionInvitation.findMany({
    where: { dealerId: dealer.id },
    include: { auction: { include: { _count: { select: { offers: true } } } } },
    orderBy: { sentAt: "desc" },
    take: 20,
  });

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-leads-page">
      <div className="flex items-center gap-3 mb-6">
        <Users size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Leads</h1>
      </div>
      {leads.length === 0 ? (
        <div className="text-center py-16 text-slate-400" data-testid="no-leads"><p>No leads yet</p></div>
      ) : (
        <div className="space-y-2">
          {leads.map((lead, i) => (
            <div key={lead.id} data-testid={`lead-item-${i}`} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
              <div>
                <p className="text-sm font-medium text-slate-800">Auction Lead #{lead.auctionId.slice(-6)}</p>
                <p className="text-xs text-slate-400">{lead.sentAt.toLocaleDateString()}</p>
              </div>
              <span className="text-xs text-slate-500">{lead.auction.status}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
