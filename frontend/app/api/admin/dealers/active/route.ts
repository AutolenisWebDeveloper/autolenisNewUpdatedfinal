import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  const where = q
    ? {
        status: "ACTIVE" as const,
        OR: [
          { dealershipName: { contains: q, mode: "insensitive" as const } },
          { city: { contains: q, mode: "insensitive" as const } },
          { state: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : { status: "ACTIVE" as const };

  const dealers = await prisma.dealer.findMany({
    where,
    orderBy: { dealershipName: "asc" },
    select: {
      id: true,
      dealershipName: true,
      city: true,
      state: true,
      tier: true,
      currentAuctionLoad: true,
    },
    take: 200,
  });

  return adminSuccess({ dealers });
}
