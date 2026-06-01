// GET /api/admin/dealer-outreach — list dealer recruitment prospects.
// Optional filters: status, buyerOppId. Newest first, capped at 100.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { DealerProspectStatus, type Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<string>(Object.values(DealerProspectStatus));

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const buyerOppId = searchParams.get("buyerOppId");

  const where: Prisma.DealerProspectWhereInput = {};
  if (status && VALID_STATUSES.has(status)) {
    where.status = status as DealerProspectStatus;
  }
  if (buyerOppId) {
    where.buyerOppId = buyerOppId;
  }

  try {
    const prospects = await prisma.dealerProspect.findMany({
      where,
      include: {
        buyerOpp: {
          select: {
            id: true,
            firstName: true,
            make: true,
            model: true,
            trim: true,
            yearMin: true,
            yearMax: true,
            bodyStyle: true,
            budgetAmount: true,
            monthlyPayment: true,
            timeline: true,
            zip: true,
            phone: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    return adminSuccess({ prospects });
  } catch (err) {
    return adminError(
      "FETCH_FAILED",
      err instanceof Error ? err.message : "Failed to fetch prospects",
      500,
    );
  }
}
