// lib/services/dealer/dealer-profile.service.ts
import { prisma } from "@/lib/prisma";

export async function updateDealerProfile(dealerId: string, data: { dealershipName?: string; phone?: string; address?: string; city?: string; state?: string; zip?: string }) {
  return prisma.dealer.update({ where: { id: dealerId }, data });
}

export async function getDealerWithFullProfile(dealerId: string) {
  return prisma.dealer.findUnique({
    where: { id: dealerId },
    include: { user: true, scorecardSnapshots: { orderBy: { snapshotDate: "desc" }, take: 1 }, _count: { select: { offers: true, inventory: true, invitations: true } } },
  });
}

export async function setDealerStatus(dealerId: string, status: "ACTIVE" | "SUSPENDED" | "TERMINATED", adminId: string) {
  const dealer = await prisma.dealer.update({ where: { id: dealerId }, data: { status } });
  await prisma.adminAuditLog.create({ data: { adminId, adminEmail: "system", action: "STATUS_CHANGE", entityType: "Dealer", entityId: dealerId, reason: `Status changed to ${status}`, metadata: { newStatus: status } } }).catch(() => {});
  return dealer;
}
