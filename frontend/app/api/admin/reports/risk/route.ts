import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { runHealthCheck } from "@/lib/services/monitoring/health.service";
import { prisma } from "@/lib/prisma";
import { computeDealRisk } from "@/lib/services/deal/deal-risk.service";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  // Paginated with risk scores
  const deals = await prisma.deal.findMany({
    where: { status: { notIn: ["COMPLETED", "CANCELLED", "REFUNDED"] } },
    include: { buyer: { select: { firstName: true, lastName: true } }, offer: { select: { otdPriceCents: true } } },
    orderBy: { riskScore: { sort: "desc", nulls: "last" } },
    take: 50,
  });

  return adminSuccess({ deals });
}
