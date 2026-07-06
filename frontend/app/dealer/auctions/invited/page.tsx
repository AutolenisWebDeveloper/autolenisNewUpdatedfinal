import { requireDealer } from "@/lib/auth/dealer-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { MailOpen } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DealerAuctionsInvitedPage() {
  const dealer = await requireDealer();

  const invitations = await prisma.auctionInvitation.findMany({
    where: {
      dealerId: dealer.id,
      auction: { status: "ACTIVE" },
    },
    include: {
      auction: {
        select: {
          id: true,
          status: true,
          endsAt: true,
        },
      },
    },
    orderBy: { sentAt: "desc" },
  });

  function expiryText(endsAt?: Date | null): string {
    if (!endsAt) return "48-hour window";
    const diffMs = endsAt.getTime() - Date.now();
    if (diffMs <= 0) return "Expired";
    const hours = Math.floor(diffMs / 1000 / 60 / 60);
    if (hours < 1) return "< 1 hour remaining";
    return `${hours}h remaining`;
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="dealer-auctions-invited-page">
      <div className="flex items-center gap-3 mb-6">
        <MailOpen size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Auction Invitations</h1>
        {invitations.length > 0 && (
          <Badge variant="secondary">{invitations.length}</Badge>
        )}
      </div>

      {invitations.length === 0 ? (
        <div className="text-center py-20 text-slate-400" data-testid="no-invitations">
          <MailOpen size={40} className="mx-auto mb-4 text-slate-300" />
          <p className="font-semibold text-slate-600">No active invitations</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            Active auction invitations will appear here. Invitations are matched to your inventory,
            tier, and capacity.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {invitations.map((inv) => (
            <Link
              key={inv.id}
              href={`/dealer/auctions/${inv.auction.id}`}
              data-testid={`invitation-item-${inv.id}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-5 hover:border-al-primary/30 transition-colors"
            >
              <div>
                <p className="font-semibold text-slate-900 text-sm font-mono">
                  Auction #{inv.auction.id.slice(0, 8)}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  Sent {inv.sentAt.toLocaleDateString()} &middot;{" "}
                  {expiryText(inv.auction.endsAt)}
                </p>
              </div>
              <Badge variant="blue">ACTIVE</Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
