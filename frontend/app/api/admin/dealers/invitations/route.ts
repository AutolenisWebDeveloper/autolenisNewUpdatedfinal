// GET /api/admin/dealers/invitations — list dealer invitations

import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const url = new URL(request.url);
  const status = url.searchParams.get("status");

  // Mark expired invitations
  await prisma.dealerInvitation.updateMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED" },
  });

  // Columns are named explicitly. Prisma selects every model scalar by default,
  // which would ask for token_hash / consumed_at — absent until migration
  // 20260828000000 is applied — and fail the whole listing with P2022. Naming
  // them also keeps token material out of a response that never needed it.
  const invitations = await prisma.dealerInvitation.findMany({
    where: status ? { status: status as "PENDING" | "ACCEPTED" | "EXPIRED" | "CANCELLED" } : undefined,
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      dealershipName: true,
      contactName: true,
      email: true,
      status: true,
      expiresAt: true,
      acceptedAt: true,
      createdAt: true,
    },
  });

  return NextResponse.json({
    success: true,
    data: invitations.map(inv => ({
      id: inv.id,
      dealershipName: inv.dealershipName,
      contactName: inv.contactName,
      email: inv.email,
      status: inv.status,
      expiresAt: inv.expiresAt.toISOString(),
      acceptedAt: inv.acceptedAt?.toISOString() ?? null,
      createdAt: inv.createdAt.toISOString(),
    })),
  });
}
