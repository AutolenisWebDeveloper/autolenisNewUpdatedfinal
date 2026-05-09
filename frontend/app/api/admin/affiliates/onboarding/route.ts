import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = request.nextUrl;
  const status = searchParams.get("status") ?? undefined;
  const search = searchParams.get("search") ?? undefined;
  const page   = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit  = 20;

  const where = {
    ...(status ? { status: status as never } : {}),
    ...(search ? {
      affiliate: { user: { email: { contains: search, mode: "insensitive" as const } } },
    } : {}),
  };

  const [reviews, total] = await Promise.all([
    prisma.affiliateOnboardingReview.findMany({
      where,
      include: {
        affiliate: { include: { user: { select: { email: true } } } },
      },
      orderBy: { updatedAt: "desc" },
      skip:    (page - 1) * limit,
      take:    limit,
    }),
    prisma.affiliateOnboardingReview.count({ where }),
  ]);

  return adminSuccess({ reviews, total, page, limit });
}
