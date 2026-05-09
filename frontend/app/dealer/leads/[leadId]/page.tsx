import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";

interface Props { params: Promise<{ leadId: string }> }

export default async function DealerLeadDetailPage({ params }: Props) {
  const { leadId } = await params;
  const dealer = await requireDealer();
  const lead = await prisma.auctionInvitation.findFirst({
    where: { id: leadId, dealerId: dealer.id },
    include: { auction: true },
  });
  if (!lead) notFound();

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="lead-detail-page">
      <h1 className="text-xl font-bold text-slate-900 mb-6">Lead Detail</h1>
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <p className="text-sm text-slate-500">Auction status: <strong>{lead.auction.status}</strong></p>
        <p className="text-sm text-slate-500 mt-1">Invited: {lead.sentAt.toLocaleDateString()}</p>
      </div>
    </div>
  );
}
