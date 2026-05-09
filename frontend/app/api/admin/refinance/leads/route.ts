import { NextRequest, NextResponse } from "next/server";
import { getAdminFromRequest } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { RefinanceStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const VALID_STATUSES = new Set(Object.values(RefinanceStatus) as string[]);

// GET /api/admin/refinance/leads
//   ?status=QUALIFIED|INELIGIBLE|REDIRECTED|EXCLUDED_STATE|SUBMITTED (optional)
//   ?format=csv   (optional — returns a CSV stream for export)
//   ?page=1
export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json(
      { error: { code: "UNAUTHENTICATED", message: "Admin session required" } },
      { status: 401 },
    );
  }
  const { searchParams } = request.nextUrl;

  const statusParam = searchParams.get("status");
  const where = statusParam && VALID_STATUSES.has(statusParam)
    ? { status: statusParam as RefinanceStatus }
    : {};
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const format = searchParams.get("format");

  // CSV export — return all rows matching filter, no pagination.
  if (format === "csv") {
    const rows = await prisma.refinanceApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: {
        leadId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        state: true,
        vehicleYear: true,
        loanBalanceCents: true,
        monthlyPaymentCents: true,
        interestRateBand: true,
        employmentStatus: true,
        status: true,
        createdAt: true,
        redirectedAt: true,
        consentTimestamp: true,
      },
    });

    const header = [
      "lead_id", "first_name", "last_name", "email", "phone", "state",
      "vehicle_year", "loan_balance_dollars", "monthly_payment_dollars",
      "interest_rate_band", "employment_status", "status",
      "submitted_at", "redirected_at", "consent_timestamp",
    ].join(",");
    const escape = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = rows.map((r) =>
      [
        r.leadId, r.firstName, r.lastName, r.email, r.phone, r.state,
        r.vehicleYear, (r.loanBalanceCents / 100).toFixed(2), (r.monthlyPaymentCents / 100).toFixed(2),
        r.interestRateBand, r.employmentStatus, r.status,
        r.createdAt.toISOString(),
        r.redirectedAt ? r.redirectedAt.toISOString() : "",
        r.consentTimestamp ? r.consentTimestamp.toISOString() : "",
      ].map(escape).join(","),
    );
    const csv = [header, ...lines].join("\n");
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="refinance-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  }

  const [total, items] = await Promise.all([
    prisma.refinanceApplication.count({ where }),
    prisma.refinanceApplication.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        leadId: true,
        firstName: true,
        lastName: true,
        email: true,
        state: true,
        vehicleYear: true,
        loanBalanceCents: true,
        status: true,
        createdAt: true,
        redirectedAt: true,
      },
    }),
  ]);

  return NextResponse.json({
    success: true,
    data: {
      items,
      total,
      page,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      pageSize: PAGE_SIZE,
    },
  });
}
