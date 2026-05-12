import { NextRequest } from "next/server";
import { getAdminFromRequest, adminError, adminSuccess } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const commissions = await prisma.commission.findMany({
    where: status ? { status: status as never } : undefined,
    include: {
      affiliate: {
        include: {
          user: { select: { email: true } },
          profile: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  return adminSuccess({
    commissions: commissions.map(c => ({
      id: c.id,
      affiliateId: c.affiliateId,
      affiliateName: `${c.affiliate.profile?.firstName ?? ""} ${c.affiliate.profile?.lastName ?? ""}`.trim() || "—",
      affiliateEmail: c.affiliate.user.email,
      amountCents: c.amountCents,
      level: c.level,
      status: c.status,
      dealId: c.dealId,
      paidAt: c.paidAt?.toISOString() ?? null,
      approvedAt: null,
      rejectedReason: null,
      paymentMethod: null,
      paymentReference: null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
}
