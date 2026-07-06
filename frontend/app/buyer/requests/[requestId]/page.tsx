import type { Metadata } from "next";

export const metadata: Metadata = { title: "Request Details", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, RefreshCw } from "lucide-react";
import { toBuyerLabel } from "@/lib/services/vehicle-request/vehicle-request.service";
import { parseRequestNotes } from "@/lib/services/vehicle-request/notes-parser";
import {
  paymentMethodLabel,
  preApprovalStatusLabel,
  purchaseTimeframeLabel,
} from "@/lib/services/vehicle-request/car-request-financing.service";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ requestId: string }> }

export default async function RequestDetailPage({ params }: Props) {
  const { requestId } = await params;
  const buyer = await requireBuyer();
  const req = await prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId: buyer.id },
    include: {
      buyerUpdates: { orderBy: { createdAt: "desc" } },
      offers: { where: { status: "SENT" } },
      financing: true,
    },
  });
  if (!req) notFound();

  const hasOffer = req.status === "OFFER_SENT" && req.offers.length > 0;
  const isClosedNoMatch = req.status === "CLOSED_NO_MATCH";
  const { text: notesText, meta } = parseRequestNotes(req.notes);

  // Pre-populate next-request URL from the existing meta + base fields so a closed
  // request flows directly into a new wizard with prior selections intact.
  const adjustParams = new URLSearchParams();
  if (meta?.vehicleType)            adjustParams.set("vehicleType", meta.vehicleType);
  if (meta?.condition)              adjustParams.set("condition", meta.condition);
  if (meta?.timeline)                adjustParams.set("timeline", meta.timeline);
  if (meta?.zip)                     adjustParams.set("zip", meta.zip);
  if (req.makePreference)            adjustParams.set("makePreference", req.makePreference);
  if (req.modelPreference)           adjustParams.set("modelPreference", req.modelPreference);
  if (req.maxBudgetCents)            adjustParams.set("maxBudgetCents", String(req.maxBudgetCents));
  if (meta?.features?.length)        adjustParams.set("features", meta.features.join(","));
  const adjustHref = `/buyer/requests/new${adjustParams.toString() ? `?${adjustParams.toString()}` : ""}`;

  return (
    <div className="p-6 md:p-8 max-w-2xl" data-testid="request-detail-page">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-bold text-slate-900">Vehicle Request</h1>
        <Badge variant={req.status === "OFFER_SENT" ? "blue" : "secondary"} data-testid="request-status-badge">
          {toBuyerLabel(req.status)}
        </Badge>
      </div>

      {/* Request details */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="request-details">
        <div className="grid grid-cols-2 gap-4 text-sm">
          {req.makePreference && <div><p className="text-slate-400 text-xs mb-0.5">Make</p><p className="font-medium text-slate-800">{req.makePreference}</p></div>}
          {req.modelPreference && <div><p className="text-slate-400 text-xs mb-0.5">Model</p><p className="font-medium text-slate-800">{req.modelPreference}</p></div>}
          {meta?.vehicleType && <div><p className="text-slate-400 text-xs mb-0.5">Vehicle type</p><p className="font-medium text-slate-800">{meta.vehicleType}</p></div>}
          {meta?.condition && <div><p className="text-slate-400 text-xs mb-0.5">Condition</p><p className="font-medium text-slate-800">{meta.condition}</p></div>}
          {meta?.timeline && <div><p className="text-slate-400 text-xs mb-0.5">Timeline</p><p className="font-medium text-slate-800">{meta.timeline}</p></div>}
          {meta?.zip && <div><p className="text-slate-400 text-xs mb-0.5">ZIP</p><p className="font-medium text-slate-800">{meta.zip}</p></div>}
          {req.maxBudgetCents && <div><p className="text-slate-400 text-xs mb-0.5">Budget</p><p className="font-medium text-slate-800">${(req.maxBudgetCents / 100).toLocaleString()}</p></div>}
          {meta?.maxMileage && <div><p className="text-slate-400 text-xs mb-0.5">Max mileage</p><p className="font-medium text-slate-800">{meta.maxMileage.toLocaleString()} mi</p></div>}
        </div>
        {meta?.features && meta.features.length > 0 && (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <p className="text-slate-400 text-xs mb-2">Must-have features</p>
            <div className="flex flex-wrap gap-1.5">
              {meta.features.map(f => (
                <span key={f} className="rounded-full border border-[#E5E7EB] bg-[#F8F9FB] px-2.5 py-1 text-xs text-al-primary font-medium">{f}</span>
              ))}
            </div>
          </div>
        )}
        {notesText && (
          <p className="text-sm text-slate-600 mt-3 border-t border-slate-100 pt-3 whitespace-pre-line" data-testid="request-notes-text">
            {notesText}
          </p>
        )}
      </div>

      {/* Financing summary (buyer-facing — confirmation only, no sensitive amounts) */}
      {req.financing ? (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mb-6" data-testid="financing-summary">
          <p className="font-semibold text-slate-800 text-sm mb-3">Your Financing Info</p>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Payment method</p>
              <p className="font-medium text-slate-800">{paymentMethodLabel(req.financing.paymentMethod)}</p>
            </div>
            <div>
              <p className="text-slate-400 text-xs mb-0.5">Pre-approval status</p>
              <p className="font-medium text-slate-800">{preApprovalStatusLabel(req.financing.preApprovalStatus)}</p>
            </div>
            {req.financing.purchaseTimeframe && (
              <div>
                <p className="text-slate-400 text-xs mb-0.5">Purchase timeframe</p>
                <p className="font-medium text-slate-800">{purchaseTimeframeLabel(req.financing.purchaseTimeframe)}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-6" data-testid="financing-empty-state">
          <p className="text-sm text-slate-500 font-medium">No financing info provided</p>
          <p className="text-xs text-slate-400 mt-0.5">Adding financing details helps us match you with better offers.</p>
        </div>
      )}
      {isClosedNoMatch && (
        <div
          className="bg-amber-50 border-2 border-amber-200 rounded-xl p-5 mb-6"
          data-testid="no-match-banner"
        >
          <div className="flex items-start gap-3">
            <RefreshCw size={18} className="text-amber-700 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-amber-900 mb-1">No match found — your $99 Auction Access Fee is refundable</p>
              <p className="text-sm text-amber-800 mb-4">
                Our team was unable to source a vehicle that fits this request. You can adjust your preferences and try again at no additional cost.
              </p>
              <Link
                href={adjustHref}
                data-testid="adjust-request-btn"
                className="inline-flex items-center gap-2 rounded-lg bg-al-primary text-white font-semibold text-sm px-4 h-10 hover:bg-al-primary-hover transition-colors"
              >
                Adjust Your Request <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Offer prompt */}
      {hasOffer && (
        <div className="bg-al-primary/5 border-2 border-al-primary rounded-xl p-5 mb-6" data-testid="offer-available-banner">
          <p className="font-semibold text-al-primary mb-1">An offer is ready for you</p>
          <p className="text-sm text-slate-600 mb-3">Our team has sourced a vehicle matching your request and prepared an offer.</p>
          <Button href={`/buyer/requests/${requestId}/offer`} data-testid="view-offer-btn">
            View Offer <ArrowRight size={14} />
          </Button>
        </div>
      )}

      {/* Buyer updates timeline */}
      {req.buyerUpdates.length > 0 && (
        <div data-testid="buyer-updates">
          <h2 className="font-semibold text-slate-900 mb-3 text-sm">Updates</h2>
          <div className="space-y-2">
            {req.buyerUpdates.map((update) => (
              <div key={update.id} className="bg-white border border-slate-200 rounded-lg p-4" data-testid={`update-${update.id}`}>
                <p className="font-semibold text-slate-800 text-sm">{update.title}</p>
                <p className="text-slate-500 text-sm mt-0.5">{update.body}</p>
                <p className="text-xs text-slate-400 mt-1">{update.createdAt.toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cancel */}
      {!["CANCELLED", "DEAL_CREATED", "CLOSED_NO_MATCH"].includes(req.status) && (
        <div className="mt-8 border-t border-slate-100 pt-6">
          <form action={`/api/buyer/requests/${requestId}/cancel`} method="post">
            <button type="submit" data-testid="cancel-request-btn" className="text-sm text-slate-400 hover:text-red-500">
              Cancel this request
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
