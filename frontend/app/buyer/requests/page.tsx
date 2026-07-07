import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Requests" };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ClipboardList, Plus } from "lucide-react";
import { toBuyerLabel } from "@/lib/services/vehicle-request/vehicle-request.service";

export const dynamic = "force-dynamic";

export default async function RequestsListPage() {
  const buyer = await requireBuyer();
  const requests = await prisma.vehicleRequest.findMany({
    where: { buyerId: buyer.id },
    include: { buyerUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="p-6 md:p-8 max-w-3xl" data-testid="requests-list-page">
      {/* Journey navigator is suppressed here by JourneyNavigator component itself */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <ClipboardList size={22} className="text-al-primary" />
          <h1 className="text-xl font-bold text-slate-900">My Vehicle Requests</h1>
        </div>
        <Button size="sm" href="/buyer/requests/new" data-testid="new-request-btn">
          <Plus size={14} />New Request
        </Button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800" data-testid="requests-explainer">
        <p className="font-semibold mb-1">Request a Specific Car</p>
        <p>Can&apos;t find the exact vehicle you want? Submit a request. Our team will source it and send you a private offer — no auction required.</p>
      </div>

      {requests.length === 0 ? (
        <div className="text-center py-20 bg-white border border-slate-200 rounded-xl" data-testid="no-requests">
          <p className="text-slate-500 mb-4">No requests yet</p>
          <Button variant="secondary" href="/buyer/requests/new" data-testid="create-first-request-btn">
            Create Your First Request
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => (
            <Link key={req.id} href={`/buyer/requests/${req.id}`} data-testid={`request-item-${req.id}`}
              className="block bg-white border border-slate-200 rounded-xl p-5 hover:border-al-primary hover:shadow-sm transition-all">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Badge variant={req.status === "OFFER_SENT" ? "blue" : req.status === "CANCELLED" ? "gray" : "secondary"}>
                    {/* Buyer-facing label — never show internal status names */}
                    {toBuyerLabel(req.status)}
                  </Badge>
                  {req.status === "OFFER_SENT" && (
                    <span className="text-xs font-semibold text-al-primary animate-pulse">New Offer!</span>
                  )}
                </div>
                <p className="text-xs text-slate-400">{req.createdAt.toLocaleDateString()}</p>
              </div>
              <p className="text-sm font-medium text-slate-900">
                {[req.makePreference, req.modelPreference, req.yearMin && `${req.yearMin}+`].filter(Boolean).join(" ") || "Vehicle Request"}
              </p>
              {req.buyerUpdates[0] && (
                <p className="text-xs text-slate-500 mt-1">{req.buyerUpdates[0].body}</p>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
