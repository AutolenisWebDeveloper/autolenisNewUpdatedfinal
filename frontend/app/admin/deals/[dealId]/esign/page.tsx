import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PenLine } from "lucide-react";
import { AdminESignActions } from "@/components/admin/AdminESignActions";

interface Props { params: Promise<{ dealId: string }> }
export const dynamic = "force-dynamic";

export default async function AdminDealESignPage({ params }: Props) {
  const { dealId } = await params;
  await requireAdmin();
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { buyer: true, eSignEnvelope: true },
  });
  if (!deal) notFound();

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="admin-deal-esign-page">
      <div className="flex items-center gap-3 mb-4"><PenLine size={20} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">E-Sign — Deal #{dealId.slice(-8)}</h1></div>
      <p className="text-sm text-slate-500 mb-6">Buyer: {deal.buyer.firstName} {deal.buyer.lastName}</p>
      {deal.eSignEnvelope ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3" data-testid="deal-envelope-details">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-800">Envelope Status</p>
            <Badge variant={deal.eSignEnvelope.status === "COMPLETED" ? "green" : "amber"}>{deal.eSignEnvelope.status}</Badge>
          </div>
          <p className="text-sm text-slate-500">Legacy E-Sign ID: {deal.eSignEnvelope.docusignEnvelopeId ?? "—"}</p>
          {deal.eSignEnvelope.sentAt && <p className="text-sm text-slate-500">Sent: {deal.eSignEnvelope.sentAt.toLocaleDateString()}</p>}
          {deal.eSignEnvelope.completedAt && <p className="text-sm text-slate-500">Completed: {deal.eSignEnvelope.completedAt.toLocaleDateString()}</p>}
          <AdminESignActions dealId={dealId} envelopeStatus={deal.eSignEnvelope.status} />
        </div>
      ) : (
        <div className="text-center py-10 bg-white border border-slate-200 rounded-xl text-slate-400" data-testid="no-envelope">
          <p>No envelope created yet for this deal.</p>
          <AdminESignActions dealId={dealId} envelopeStatus={null} />
        </div>
      )}
    </div>
  );
}
