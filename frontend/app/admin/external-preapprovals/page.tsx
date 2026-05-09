import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import ExternalPreApprovalActionsClient from "@/components/admin/ExternalPreApprovalActionsClient";

export const dynamic = "force-dynamic";

export default async function AdminExternalPreApprovalsPage() {
  await requireAdmin();
  const submissions = await prisma.externalPreApproval.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const serialized = submissions.map(s => ({
    id: s.id,
    buyerId: s.buyerId,
    lenderName: s.lenderName,
    approvedAmountCents: s.approvedAmountCents,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
  }));

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-external-preapprovals">
      <h1 className="text-xl font-bold text-slate-900 mb-4">
        External Pre-Approvals ({submissions.length})
      </h1>
      <ExternalPreApprovalActionsClient submissions={serialized} />
    </div>
  );
}

