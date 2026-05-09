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

  const inv = await prisma.dealerInvitation.findUnique({ where: { id: invId } });
  if (!inv) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (inv.status === "ACCEPTED") return NextResponse.json({ error: "Cannot cancel accepted invitation" }, { status: 409 });
  if (inv.status === "CANCELLED") return NextResponse.json({ error: "Already cancelled" }, { status: 409 });

  await prisma.dealerInvitation.update({ where: { id: invId }, data: { status: "CANCELLED" } });

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
