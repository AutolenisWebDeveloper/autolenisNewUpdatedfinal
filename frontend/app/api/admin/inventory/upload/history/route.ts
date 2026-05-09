// GET /api/admin/inventory/upload/history — list all past upload sessions

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

  const batches = await prisma.inventoryUploadBatch.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return adminSuccess({ batches, count: batches.length });
}
