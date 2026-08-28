// POST /api/admin/dealers/invitations/[invId]/cancel

import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface RouteContext { params: Promise<{ invId: string }> }

export async function POST(request: NextRequest, { params }: RouteContext) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const { invId } = await params;

  // Explicit select + updateMany: an unqualified query would ask for token_hash /
  // consumed_at, which do not exist until migration 20260828000000 is applied.
  const inv = await prisma.dealerInvitation.findUnique({
    where: { id: invId },
    select: { id: true, status: true },
  });
  if (!inv) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (inv.status === "ACCEPTED") return NextResponse.json({ error: "Cannot cancel accepted invitation" }, { status: 409 });
  if (inv.status === "CANCELLED") return NextResponse.json({ error: "Already cancelled" }, { status: 409 });

  // Guarded on status so a claim that landed since the read above is not undone.
  const cancelled = await prisma.dealerInvitation.updateMany({
    where: { id: invId, status: { in: ["PENDING", "EXPIRED"] } },
    data: { status: "CANCELLED" },
  });
  if (cancelled.count !== 1) {
    return NextResponse.json({ error: "Invitation can no longer be cancelled" }, { status: 409 });
  }

  await prisma.adminAuditLog.create({
    data: {
      adminId: admin.adminId,
      adminEmail: admin.email,
      action: "STATUS_CHANGE",
      entityType: "DealerInvitation",
      entityId: invId,
      reason: "Invitation cancelled",
    },
  }).catch(() => {});

  return NextResponse.json({ success: true });
}
