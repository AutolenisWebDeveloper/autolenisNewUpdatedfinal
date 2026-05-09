// /admin/auctions/[auctionId] — Full auction detail
// Dealer identity visible to admin (unlike buyer view)
// Best Price Engine output panel
// Admin actions: close, extend, remove dealer, trigger refund — all logged to AdminAuditLog

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import AdminAuctionDetail from "@/components/admin/AdminAuctionDetail";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ auctionId: string }> }

export default async function AdminAuctionDetailPage({ params }: Props) {
  const { auctionId } = await params;
  const admin = await requireAdmin();

  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: {
      buyer: { include: { user: true, preQualification: true } },
      deposit: true,
      offers: {
        include: { dealer: { include: { user: true } } },
        orderBy: { otdPriceCents: "asc" },
      },
      invitations: {
        include: { dealer: { select: { id: true, dealershipName: true, tier: true } } },
      },
    },
  });
  if (!auction) notFound();

  const auditLogs = await prisma.adminAuditLog.findMany({
    where: { entityType: "Auction", entityId: auctionId },
    orderBy: { createdAt: "desc" },
    take: 30,
  });

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-auction-detail-page">
      <AdminAuctionDetail
        auction={JSON.parse(JSON.stringify(auction))}
        auditLogs={JSON.parse(JSON.stringify(auditLogs))}
        adminId={admin.adminId}
        adminEmail={admin.email}
      />
    </div>
  );
}
