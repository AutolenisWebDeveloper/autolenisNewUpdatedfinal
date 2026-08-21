// /admin/requests — System 4C admin intake queue
// Tabs: New / Active / Offer Out / Closed

import { requireAdmin } from "@/lib/auth/admin-session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, AlertTriangle, BarChart2 } from "lucide-react";
import { VehicleRequestStatus } from "@prisma/client";
import { vehicleRequestStatusLabel } from "@/lib/domain/status-labels";

export const dynamic = "force-dynamic";

const TAB_FILTERS: Record<string, VehicleRequestStatus[]> = {
  New:       ["SUBMITTED", "INTAKE"],
  Active:    ["ACTIVE_SOURCING", "OFFER_READY"],
  "Offer Out": ["OFFER_SENT", "OFFER_ACCEPTED", "OFFER_DECLINED"],
  Closed:    ["DEAL_CREATED", "CLOSED_NO_MATCH", "CANCELLED", "EXPIRED"],
};

const BADGE_STYLES: Record<string, string> = {
  NEEDS_PREQUAL:          "bg-slate-100 text-slate-600",
  OUTSIDE_APPROVAL:       "bg-blue-100 text-blue-700",
  CASH_BUYER:             "bg-green-100 text-green-700",
  LEASE_PROSPECT:         "bg-purple-100 text-purple-700",
  FINANCING_OPPORTUNITY:  "bg-amber-100 text-amber-700",
};

export default async function AdminRequestsPage() {
  await requireAdmin();

  let requests: Awaited<ReturnType<typeof prisma.vehicleRequest.findMany<{
    include: {
      buyer: true;
      financing: true;
      _count: { select: { checkpoints: true; offers: true } };
    };
  }>>> = [];
  let loadError: string | null = null;

  try {
    requests = await prisma.vehicleRequest.findMany({
      include: {
        buyer: true,
        financing: true,
        _count: { select: { checkpoints: true, offers: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200, // bounded — the queue view is triage, not an archive
    });
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Unknown error loading requests";
  }

  const newCount = requests.filter(r => TAB_FILTERS.New.includes(r.status)).length;

  return (
    <div className="p-6 md:p-8 max-w-5xl" data-testid="admin-requests-page">
      <div className="flex items-center gap-3 mb-6">
        <ClipboardList size={22} className="text-al-primary" />
        <h1 className="text-xl font-bold text-slate-900">Request a Car Queue (System 4C)</h1>
        {newCount > 0 && <Badge>{newCount} new</Badge>}
        <Link
          href="/admin/requests/analytics"
          data-testid="admin-requests-analytics-link"
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 hover:border-[#93C5FD] hover:bg-al-primary/5 text-slate-600 hover:text-al-primary rounded-lg text-xs font-semibold transition-colors"
        >
          <BarChart2 size={13} />
          Analytics
        </Link>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4 flex items-start gap-2 text-red-700" data-testid="requests-load-error">
          <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Failed to load requests</p>
            <p className="text-xs mt-0.5 font-mono">{loadError}</p>
          </div>
        </div>
      )}

      {!loadError && requests.length === 0 && (
        <div className="text-center py-12 text-slate-400" data-testid="no-requests">No vehicle requests found</div>
      )}

      <div className="space-y-3">
        {requests.map(req => {
          const tabLabel = Object.entries(TAB_FILTERS).find(([, statuses]) => statuses.includes(req.status))?.[0] ?? "Closed";
          const badge = req.financing?.adminBadge;
          const score = req.financing?.leadQualityScore;
          return (
            <Link key={req.id} href={`/admin/requests/${req.id}`} data-testid={`request-row-${req.id}`}
              className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-5 py-4 hover:border-al-primary/30 transition-colors">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{req.buyer?.firstName ?? ""} {req.buyer?.lastName ?? ""}</p>
                <p className="text-xs text-slate-400">
                  {[req.makePreference, req.modelPreference, req.yearMin && `${req.yearMin}+`].filter(Boolean).join(" ") || "Any vehicle"}
                  {" · "}{req.createdAt.toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                {badge && (
                  <span
                    data-testid={`admin-badge-${req.id}`}
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${BADGE_STYLES[badge] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {badge.replace(/_/g, " ")}
                  </span>
                )}
                <span className="text-xs font-mono text-slate-500" data-testid={`lead-score-${req.id}`}>
                  {score != null ? `${score}/100` : "—"}
                </span>
                <Badge variant="secondary" className="text-xs">{tabLabel}</Badge>
                <Badge variant={req.status === "OFFER_SENT" ? "blue" : req.status === "CANCELLED" ? "gray" : "secondary"} className="text-xs">{vehicleRequestStatusLabel(req.status)}</Badge>
                <span className="text-xs text-slate-400">{req._count.checkpoints} checkpoints · {req._count.offers} offers</span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
