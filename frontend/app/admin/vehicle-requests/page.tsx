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
  city?: string;
  state?: string;
  vehicleType?: string;
  preferredMake?: string;
  preferredModel?: string;
  budget?: string;
  newOrUsed?: string;
  financingNeeded?: string;
  financingOption?: string;
  timeline?: string;
  requestStatus?: string;
};

const STATUS_LABEL: Record<string, string> = {
  new: "New",
  sent_to_dealers: "Sent to Dealers",
  offers_in: "Offers In",
  sent_to_buyer: "Sent to Buyer",
  buyer_interested: "Buyer Interested",
  closed: "Closed",
  lost: "Lost",
};

const STATUS_TONE: Record<string, string> = {
  new: "bg-blue-100 text-blue-700 border-blue-200",
  sent_to_dealers: "bg-amber-100 text-amber-700 border-amber-200",
  offers_in: "bg-violet-100 text-violet-700 border-violet-200",
  sent_to_buyer: "bg-cyan-100 text-cyan-700 border-cyan-200",
  buyer_interested: "bg-green-100 text-green-700 border-green-200",
  closed: "bg-slate-100 text-slate-600 border-slate-200",
  lost: "bg-red-100 text-red-700 border-red-200",
};

function safeParse(meta: unknown): RequestMeta | null {
  if (!meta || typeof meta !== "object") return null;
  return meta as RequestMeta;
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
            const status = meta.requestStatus ?? "new";
            return (
              <Link
                key={req.id}
                href={`/admin/vehicle-requests/${req.id}`}
                data-testid={`vehicle-request-row-${req.id}`}
                className="block bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-[#0B5FD1]/40 hover:shadow-sm transition-all"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-semibold text-slate-900 text-sm truncate">
                        {meta.fullName ?? "Unknown"}
                      </p>
                      <span className={`text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5 ${STATUS_TONE[status] ?? STATUS_TONE.new}`}>
                        {STATUS_LABEL[status] ?? status}
                      </span>
                    </div>
                    {meta.email ? <p className="text-xs text-slate-500 truncate">{meta.email}{meta.phone ? ` · ${meta.phone}` : ""}</p> : null}
                    <p className="text-xs text-slate-400 mt-0.5">
                      {[meta.vehicleType, meta.preferredMake, meta.preferredModel].filter(Boolean).join(" ") || "Any vehicle"}
                      {meta.budget ? ` · ${meta.budget}` : ""}
                      {meta.city || meta.state ? ` · ${[meta.city, meta.state].filter(Boolean).join(", ")} ${meta.zip ?? ""}`.trim() : meta.zip ? ` · ZIP ${meta.zip}` : ""}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {meta.newOrUsed ? `${meta.newOrUsed} · ` : ""}
                      {meta.timeline ? `${meta.timeline} · ` : ""}
                      Submitted {req.createdAt.toLocaleString()}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-[#0B5FD1] shrink-0">View →</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
