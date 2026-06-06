// /admin/prequal-errors — Provider-failure triage queue (P0-2).
//
// Lists unresolved PrequalAttemptError rows (provider failures downgraded to
// MANUAL_REVIEW) newest first, filterable by stage/code, each linking to the
// buyer's prequal panel. Resolving writes resolvedAt/resolvedBy + an audit log.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import PrequalErrorsClient, { type PrequalErrorRow } from "./PrequalErrorsClient";

export const dynamic = "force-dynamic";

export default async function AdminPrequalErrorsPage() {
  await requireAdmin();

  const records = await prisma.prequalAttemptError.findMany({
    where: { resolvedAt: null },
    orderBy: { attemptedAt: "desc" },
    take: 500,
    include: {
      buyer: { include: { user: { select: { email: true } } } },
    },
  });

  const rows: PrequalErrorRow[] = records.map((r) => ({
    id: r.id,
    buyerId: r.buyerId,
    buyerName: `${r.buyer.firstName} ${r.buyer.lastName}`.trim(),
    buyerEmail: r.buyer.user.email,
    prequalApplicationId: r.prequalApplicationId,
    errorStage: r.errorStage,
    errorCode: r.errorCode,
    errorMessage: r.errorMessage,
    httpStatus: r.httpStatus,
    attemptedAt: r.attemptedAt.toISOString(),
  }));

  return (
    <div className="p-6 md:p-8 max-w-7xl" data-testid="admin-prequal-errors-page">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-slate-900">Prequal Provider Errors</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Unresolved MicroBilt iPredict failures downgraded to manual review.
          Each was surfaced as queryable metadata so a stalled prequal is never
          invisible. Resolve once the underlying provider issue is addressed.
        </p>
      </div>

      <PrequalErrorsClient initialRows={rows} />
    </div>
  );
}
