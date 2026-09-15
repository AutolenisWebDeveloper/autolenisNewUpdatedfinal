import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PenLine } from "lucide-react";
import { AdminESignActions } from "@/components/admin/AdminESignActions";
import { LEGACY_ENVELOPE_SELECT } from "@/lib/services/esign/esign-schema-gate";

interface Props { params: Promise<{ dealId: string }> }
export const dynamic = "force-dynamic";

export default async function AdminDealESignPage({ params }: Props) {
  const { dealId } = await params;
  const admin = await requireAdmin();
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { buyer: true, eSignEnvelopes: { select: LEGACY_ENVELOPE_SELECT, orderBy: { signerKind: "asc" } } },
  });
  if (!deal) notFound();

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="admin-deal-esign-page">
      <div className="flex items-center gap-3 mb-4"><PenLine size={20} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">E-Sign — Deal #{dealId.slice(-8)}</h1></div>
      <p className="text-sm text-slate-500 mb-6">Buyer: {deal.buyer.firstName} {deal.buyer.lastName}</p>
      {deal.eSignEnvelopes.length > 0 ? (
        <div className="space-y-4">
          {/* §13-D30. A deal can require two signatures, each its own ceremony with its own
              consent snapshot and evidence. One card per signer — an admin investigating a
              signature dispute needs to see whose is whose, not a single merged status. */}
          {deal.eSignEnvelopes.map((envelope) => (
            <div
              key={envelope.id}
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
              data-testid={`deal-envelope-details-${envelope.signerKind.toLowerCase()}`}
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="font-semibold text-slate-800">
                  {envelope.signerKind === "CO_BUYER" ? "Co-buyer" : "Buyer"} envelope
                </p>
                <Badge variant={envelope.status === "COMPLETED" ? "green" : "amber"}>{envelope.status}</Badge>
              </div>
              <p className="text-sm text-slate-500">Legacy E-Sign ID: {envelope.docusignEnvelopeId ?? "\u2014"}</p>
              {envelope.sentAt && <p className="text-sm text-slate-500">Sent: {envelope.sentAt.toLocaleDateString()}</p>}
              {envelope.completedAt && <p className="text-sm text-slate-500">Completed: {envelope.completedAt.toLocaleDateString()}</p>}
              {envelope.signerKind === "BUYER" && (
                <AdminESignActions dealId={dealId} envelopeStatus={envelope.status} adminRole={admin.role} />
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-10 bg-white border border-slate-200 rounded-xl text-slate-400" data-testid="no-envelope">
          <p>No envelope created yet for this deal.</p>
          <AdminESignActions dealId={dealId} envelopeStatus={null} adminRole={admin.role} />
        </div>
      )}
    </div>
  );
}
