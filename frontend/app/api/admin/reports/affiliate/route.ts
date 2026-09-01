import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { COMMISSION_RATES } from "@/lib/constants";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format");

  const affiliates = await prisma.affiliate.findMany({
    include: { user: { select: { email: true } }, commissions: { select: { amountCents: true, status: true, level: true } }, children: { select: { id: true } } },
  });

  const stats = affiliates.map(a => ({
    email: a.user.email, referralCode: a.referralCode,
    l1Count: a.children.length,
    totalEarned: a.commissions.filter(c => c.status !== "REVERSED").reduce((s, c) => s + c.amountCents, 0),
    paidOut: a.commissions.filter(c => c.status === "PAID").reduce((s, c) => s + c.amountCents, 0),
    status: a.status,
  }));

  if (format === "csv") {
    const csv = ["Email,Code,L1,Total Earned,Paid Out,Status",
      ...stats.map(s => `${s.email},${s.referralCode},${s.l1Count},${s.totalEarned},${s.paidOut},${s.status}`)
    ].join("\n");
    return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": 'attachment; filename="affiliates.csv"' } });
  }

  return adminSuccess({ affiliates: stats, commissionRates: COMMISSION_RATES });
}
