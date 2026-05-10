// /admin/vehicle-requests — public buyer submissions from /request-vehicle.
// Stored as Notification rows with `type: SYSTEM_ALERT` and a title prefix
// of "Vehicle Request:" so we can scope this list without a dedicated table.
import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, PlusCircle } from "lucide-react";

export const dynamic = "force-dynamic";

type RequestMeta = {
  fullName?: string;
  email?: string;
  phone?: string;
  zip?: string;
  vehicleType?: string;
  preferredMake?: string;
  preferredModel?: string;
  budget?: string;
  newOrUsed?: string;
  financingNeeded?: string;
};

function safeParse(meta: unknown): RequestMeta | null {
  if (!meta || typeof meta !== "object") return null;
  try {
    return meta as RequestMeta;
  } catch {
    return null;
  }
}

export default async function AdminVehicleRequestsPage() {
  await requireAdmin();

  const requests = await prisma.notification.findMany({
    where: {
      type: "SYSTEM_ALERT",
      title: { startsWith: "Vehicle Request:" },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <div className="p-6 md:p-8 max-w-6xl" data-testid="admin-vehicle-requests-page">
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList size={22} className="text-[#0B5FD1]" />
        <h1 className="text-xl font-bold text-slate-900">Public Vehicle Requests</h1>
        <Badge variant="secondary" className="text-xs">{requests.length}</Badge>
        <Link
          href="/admin/vehicle-offers/new"
          data-testid="create-offer-from-requests-btn"
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0B5FD1] hover:bg-[#0944a8] text-white rounded-lg text-xs font-semibold transition-colors"
        >
          <PlusCircle size={13} /> Create Offer Link
        </Link>
      </div>

      {requests.length === 0 ? (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center" data-testid="no-vehicle-requests">
          <ClipboardList size={32} className="text-slate-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-slate-700 mb-1">No public vehicle requests yet.</p>
          <p className="text-xs text-slate-500">Requests submitted at <code className="text-[11px] bg-slate-100 px-1.5 py-0.5 rounded">/request-vehicle</code> will appear here.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const meta = safeParse(req.metadata) ?? {};
            return (
              <div
                key={req.id}
                data-testid={`vehicle-request-row-${req.id}`}
                className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 text-sm truncate">
                    {meta.fullName ?? "Unknown"}
                    {meta.email ? <span className="text-slate-400 font-normal"> · {meta.email}</span> : null}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {meta.phone ? `${meta.phone} · ` : ""}
                    {[meta.vehicleType, meta.preferredMake, meta.preferredModel].filter(Boolean).join(" ") || "Any vehicle"}
                    {meta.budget ? ` · ${meta.budget}` : ""}
                    {meta.zip ? ` · ZIP ${meta.zip}` : ""}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {meta.newOrUsed ? `${meta.newOrUsed} · ` : ""}
                    {meta.financingNeeded ? `Financing: ${meta.financingNeeded} · ` : ""}
                    Submitted {req.createdAt.toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  <Link
                    href="/admin/vehicle-offers/new"
                    data-testid={`create-offer-link-${req.id}`}
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0B5FD1] border border-[#0B5FD1]/30 hover:bg-[#0B5FD1]/5 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    Create Offer Link →
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
