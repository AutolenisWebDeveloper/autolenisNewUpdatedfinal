import type { Metadata } from "next";

export const metadata: Metadata = { title: "Request Offer", robots: { index: false, follow: false } };

import { getAuthenticatedBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowLeft, ExternalLink } from "lucide-react";
import { toBuyerLabel } from "@/lib/services/vehicle-request/vehicle-request.service";
import OfferResponseButtons from "@/components/buyer/OfferResponseButtons";

export const dynamic = "force-dynamic";
interface Props { params: Promise<{ requestId: string }> }

export default async function RequestOfferPage({ params }: Props) {
  const { requestId } = await params;
  const buyer = await getAuthenticatedBuyer();
  if (!buyer) {
    redirect(`/auth/signin?redirect=/buyer/requests/${requestId}/offer`);
  }
  if (buyer.isSuspended) redirect("/buyer/suspended");

  // Direct match — request already belongs to authenticated buyer.
  let req = await prisma.vehicleRequest.findFirst({
    where: { id: requestId, buyerId: buyer.id },
    include: { offers: { where: { status: "SENT" }, take: 1 } },
  });

  // Email re-link: a guest submission may have created the request under a
  // separate guest Buyer with the same email. Transfer it on first access.
  if (!req && buyer.user?.email) {
    const reqByEmail = await prisma.vehicleRequest.findFirst({
      where:   { id: requestId, buyer: { user: { email: buyer.user.email } } },
      include: { offers: { where: { status: "SENT" }, take: 1 } },
    });
    if (reqByEmail) {
      await prisma.vehicleRequest.update({
        where: { id: requestId },
        data:  { buyerId: buyer.id },
      }).catch(() => {});
      await prisma.buyer.updateMany({
        where: { id: reqByEmail.buyerId, isGuest: true },
        data:  { isGuest: false },
      }).catch(() => {});
      req = { ...reqByEmail, buyerId: buyer.id };
    }
  }

  if (!req) notFound();

  const offer = req.offers[0];

  // ── Empty state ─ no offer yet ───────────────────────────────────────────
  if (!offer) {
    return (
      <div className="p-6 md:p-8 max-w-xl" data-testid="request-offer-empty">
        <Link
          href={`/buyer/requests/${requestId}`}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-al-primary mb-4"
          data-testid="offer-back-link"
        >
          <ArrowLeft size={14} /> Back to Request
        </Link>
        <div className="bg-white border-2 border-dashed border-[#E5E7EB] rounded-2xl p-8 text-center">
          <div className="mx-auto h-14 w-14 rounded-full bg-[#F8F9FB] flex items-center justify-center mb-4">
            <Loader2 size={26} className="text-al-primary animate-spin" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">No offer yet</h1>
          <p className="text-sm text-slate-600 mb-1">We&apos;re still sourcing options for your request.</p>
          <p className="text-xs text-slate-400 mb-6">
            Current status: <span className="font-semibold text-slate-700">{toBuyerLabel(req.status)}</span>
          </p>
          <Link
            href={`/buyer/requests/${requestId}`}
            data-testid="offer-empty-cta"
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 text-slate-700 font-medium text-sm px-5 h-10 hover:bg-slate-50 transition-colors"
          >
            View Request Details
          </Link>
        </div>
      </div>
    );
  }

  const vehicleInfo = offer.vehicleInfo as {
    year?: number; make?: string; model?: string; trim?: string;
    description?: string; otdPriceCents?: number; monthlyEstimateCents?: number;
    vehicleUrl?: string;
  };
  const otdCents = vehicleInfo.otdPriceCents ?? offer.priceCents;
  const monthlyCents = vehicleInfo.monthlyEstimateCents ?? Math.round(offer.priceCents / 60);

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="request-offer-page">
      <h1 className="text-xl font-bold text-slate-900 mb-2">Review Your Offer</h1>
      <p className="text-sm text-slate-500 mb-6">AutoLenis sourced a vehicle matching your request. Review the offer below.</p>

      {/* Offer details — vehicle card */}
      <div className="bg-white border-2 border-al-primary rounded-2xl p-7 mb-6" data-testid="offer-details">
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-2xl font-bold text-slate-900" data-testid="offer-vehicle-title">
              {vehicleInfo.year} {vehicleInfo.make} {vehicleInfo.model}
              {vehicleInfo.trim && <span className="text-slate-400 font-normal"> {vehicleInfo.trim}</span>}
            </p>
            {vehicleInfo.description && <p className="text-sm text-slate-500 mt-1">{vehicleInfo.description}</p>}
            {vehicleInfo.vehicleUrl && (
              <a
                href={vehicleInfo.vehicleUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="offer-vehicle-link"
                className="inline-flex items-center gap-2 rounded-lg border border-al-primary text-al-primary text-sm font-medium px-4 py-2 hover:bg-al-primary/5 transition-colors mt-3"
              >
                <ExternalLink size={14} />
                View This Vehicle →
              </a>
            )}
          </div>
          <Badge className="text-sm">Offer</Badge>
        </div>
        <div className="border-t border-slate-100 pt-4 grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">OTD Price</p>
            <p className="text-2xl font-bold text-al-primary font-mono" data-testid="offer-otd-price">
              ${(otdCents / 100).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-slate-400 mb-1">Est. Monthly</p>
            <p className="text-2xl font-bold text-slate-800 font-mono" data-testid="offer-monthly-estimate">
              ~${(monthlyCents / 100).toLocaleString()}/mo
            </p>
          </div>
        </div>
        {offer.notes && <p className="text-sm text-slate-600 mt-4 bg-slate-50 rounded-lg p-3 whitespace-pre-line">{offer.notes}</p>}
        <p className="text-xs text-slate-400 mt-4">Offer sent: {offer.sentAt?.toLocaleDateString()}</p>
      </div>

      {/* Accept / Decline */}
      <div data-testid="offer-response-buttons">
        <OfferResponseButtons offerId={offer.id} requestId={requestId} />
      </div>
      <p className="text-xs text-slate-400 text-center mt-4">
        Choosing this option does not obligate payment. Our team will follow up to complete the deal.
      </p>
    </div>
  );
}
