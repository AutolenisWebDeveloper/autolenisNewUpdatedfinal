import { NextRequest } from "next/server";
import { getAdminWithRole, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminWithRole(request, ["SUPER_ADMIN", "FINANCE_ADMIN"]);
  if (!admin) return adminError("FORBIDDEN", "Insufficient permissions", 403);
  const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : undefined;
  const before = await prisma.referralMilestone.findUnique({ where: { id } });
  if (!before) return adminError("NOT_FOUND", "Milestone not found", 404);
  if (before.paidAt) return adminError("ALREADY_PAID", "Milestone already marked paid", 400);
  // M9 — compare-and-set on paidAt: a double-click race writes the stamp (and
  // its audit row) exactly once instead of converging silently with two logs.
  const paidAt = new Date();
  const claimed = await prisma.referralMilestone.updateMany({
    where: { id, paidAt: null },
    data: { paidAt },
  });
  if (claimed.count !== 1) return adminError("ALREADY_PAID", "Milestone already marked paid", 400);
  const updated = { ...before, paidAt };
  await createAuditLog(admin, request, {
    action: "REFERRAL_MILESTONE_PAID",
    entityType: "ReferralMilestone",
    entityId: id,
    reason,
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
