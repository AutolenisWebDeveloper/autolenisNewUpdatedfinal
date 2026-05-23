import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  await prisma.marketCoverage.update({ where: { id }, data: { status: "INACTIVE" } });
  await createAuditLog(admin, request, {
    action: "INVENTORY_MARKET_DEACTIVATED",
    entityType: "MarketCoverage",
    entityId: id,
  });
  return adminSuccess({ deactivated: true });
}
