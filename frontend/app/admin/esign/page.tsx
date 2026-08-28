// /admin/esign — Gap Group 4.2 — central e-sign envelope management hub

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import { Badge } from "@/components/ui/badge";
import { PenLine, AlertTriangle } from "lucide-react";
import ESignHubRowActions from "@/components/admin/ESignHubRowActions";

export const dynamic = "force-dynamic";
export default async function AdminESignPage() {
  const admin = await requireAdmin();

  let envelopes: Awaited<ReturnType<typeof prisma.eSignEnvelope.findMany<{ include: { deal: { include: { buyer: true } } } }>>> = [];
  let loadError: string | null = null;

  try {
    envelopes = await prisma.eSignEnvelope.findMany({
      include: { deal: { include: { buyer: true } } },
      orderBy: { createdAt: "desc" }, take: 50,
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading envelopes";
  }

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-esign-page">
      <div className="flex items-center gap-3 mb-6"><PenLine size={22} className="text-al-primary" /><h1 className="text-xl font-bold text-slate-900">E-Sign Management</h1></div>
      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-2 text-red-700" data-testid="esign-load-error">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load e-sign envelopes</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}
      {!loadError && envelopes.length === 0 ? (
        <div className="text-center py-12 text-slate-400" data-testid="no-envelopes">No signing envelopes yet</div>
      ) : (
        <div className="space-y-2">
          {envelopes.map(env => (
            <div key={env.id} data-testid={`envelope-row-${env.id}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{env.deal?.buyer?.firstName ?? ""} {env.deal?.buyer?.lastName ?? ""}</p>
                <p className="text-xs text-slate-400">Envelope: {env.docusignEnvelopeId?.slice(-8) ?? "Pending"} · {env.createdAt.toLocaleDateString()}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={env.status === "COMPLETED" ? "green" : env.status === "VOIDED" ? "destructive" : "amber"} className="text-xs">{env.status}</Badge>
                <ESignHubRowActions dealId={env.dealId} envelopeId={env.id} status={env.status} adminRole={admin.role} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
