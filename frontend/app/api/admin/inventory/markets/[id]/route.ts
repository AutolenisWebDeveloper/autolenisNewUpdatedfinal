import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

interface Props { params: Promise<{ id: string }> }

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  await prisma.marketCoverage.update({ where: { id }, data: { status: "INACTIVE" } });
  return adminSuccess({ deactivated: true });
}
