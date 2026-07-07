// /admin/prequal — All-decisions prequalification list.
//
// Complementary to /admin/manual-reviews (which is the MANUAL_REVIEW + OFAC
// triage queue). This page shows every PreQualification with filter + search,
// so admins can audit and deep-link to any buyer's prequal panel.

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import PrequalListClient, { type PrequalListRow } from "./PrequalListClient";

export const dynamic = "force-dynamic";

export default async function AdminPrequalListPage() {
  await requireAdmin();

  const records = await prisma.preQualification.findMany({
    orderBy: { updatedAt: "desc" },
    take: 500,
    include: {
      buyer: { include: { user: { select: { email: true } } } },
    },
  });

  const rows: PrequalListRow[] = records.map((r) => ({
    id: r.id,
    buyerId: r.buyerId,
    buyerName: `${r.buyer.firstName} ${r.buyer.lastName}`.trim(),
    buyerEmail: r.buyer.user.email,
    decision: r.decision,
    tier: r.tier,
    maxOtdAmountCents: r.maxOtdAmountCents,
    expiresAt: r.expiresAt.toISOString(),
    expired: r.expiresAt.getTime() <= Date.now(),
    isExternal: r.isExternal,
    createdAt: r.createdAt.toISOString(),
  }));

  return (
    <div className="p-6 md:p-8 max-w-7xl" data-testid="admin-prequal-list-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Prequalifications</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Every prequal on the platform, filterable by decision and searchable by buyer.
          For triage of MANUAL_REVIEW and OFAC cases use{" "}
          <a href="/admin/manual-reviews" className="text-al-primary hover:underline">Manual Reviews</a>.
        </p>
      </div>

      <PrequalListClient initialRows={rows} />
    </div>
  );
}
