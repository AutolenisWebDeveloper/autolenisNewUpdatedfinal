import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);
  const before = await prisma.referralMilestone.findUnique({ where: { id } });
  if (!before) return adminError("NOT_FOUND", "Milestone not found", 404);
  if (before.paidAt) return adminError("ALREADY_PAID", "Milestone already marked paid", 400);
  const updated = await prisma.referralMilestone.update({ where: { id }, data: { paidAt: new Date() } });
  await createAuditLog(admin, request, {
    action: "REFERRAL_MILESTONE_PAID",
    entityType: "ReferralMilestone",
    entityId: id,
    metadata: {
      buyerId: before.buyerId,
      milestone: before.milestone,
      rewardType: before.rewardType,
      rewardValue: before.rewardValue,
      paidAt: updated.paidAt?.toISOString(),
    },
  });
  return adminSuccess({ paid: true, paidAt: updated.paidAt });
}
