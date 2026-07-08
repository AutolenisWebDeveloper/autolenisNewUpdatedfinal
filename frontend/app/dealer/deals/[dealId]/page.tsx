import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerDealById } from "@/lib/services/dealer/dealer-deals.service";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, Phone, MapPin, ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { CARD, FIGURE } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ dealId: string }>;
}

const STAGES = [
  "ACTIVE",
  "CONTRACT_PENDING",
  "CONTRACT_REVIEW",
  "CONTRACT_APPROVED",
  "SIGNING_PENDING",
  "SIGNED",
  "PICKUP_SCHEDULED",
  "COMPLETED",
] as const;

export default async function DealerDealDetailPage({ params }: Props) {
  const { dealId } = await params;
  const dealer = await requireDealer();

  const deal = await getDealerDealById(dealId, dealer.id);
  if (!deal) notFound();

  const currentStageIndex = STAGES.indexOf(deal.status as typeof STAGES[number]);
  // Buyer identity revealed once dealer has won (deal exists & status is no
  // longer PENDING). We gate display on a slightly later milestone to mirror
  // the buyer-side contract: contact appears once the deal moves past
  // contract review, when coordination becomes necessary.
  const contactVisible = deal.status !== "PENDING";
  const offer = deal.offer;
  const buyer = deal.buyer;

  // Next-action CTA — exactly one primary action per stage.
  const nextAction = ((): { label: string; href: string } | null => {
    switch (deal.status) {
      case "CONTRACT_PENDING":
        return { label: "Upload purchase agreement", href: "/dealer/contracts" };
      case "CONTRACT_REVIEW":
        return { label: "Awaiting Contract Shield review", href: "/dealer/contracts" };
      case "CONTRACT_APPROVED":
      case "SIGNING_PENDING":
        return { label: "Sign contract", href: "/dealer/contracts" };
      case "SIGNED":
      case "PICKUP_SCHEDULED":
        return { label: "Coordinate pickup", href: "/dealer/pickups" };
      default:
        return null;
    }
  })();

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 md:p-8" data-testid="dealer-deal-detail-page">
      <Link
        href="/dealer/deals"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors mb-6 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-al-primary/40"
      >
        <ArrowLeft size={15} /> Back to Deals
      </Link>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <h1 className="text-2xl sm:text-[1.75rem] font-bold text-slate-900 tracking-tight">Deal Progress</h1>
        <Badge variant="secondary" className="text-xs font-mono tabular-nums">
          #{deal.id.slice(0, 8)}
        </Badge>
        <Badge variant={deal.status === "COMPLETED" ? "green" : "secondary"}>
          {deal.status.replace(/_/g, " ")}
        </Badge>
      </div>

      {nextAction && (
        <div
          className="bg-al-primary-subtle border border-al-primary/20 rounded-2xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
          data-testid="deal-next-action"
        >
          <div>
            <p className="text-xs font-semibold text-al-primary uppercase tracking-wider">Next action</p>
            <p className="text-sm font-semibold text-slate-900 mt-1">{nextAction.label}</p>
          </div>
          <Button href={nextAction.href} className="shrink-0 min-h-[44px]">
            Continue →
          </Button>
        </div>
      )}

      {/* Stage Timeline */}
      <div className={cn(CARD, "p-5 mb-6")} data-testid="stage-timeline">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] mb-4">
          Deal Timeline
        </p>
        <div className="flex flex-wrap gap-y-3">
          {STAGES.map((stage, i) => {
            const isCompleted = i < currentStageIndex;
            const isCurrent = i === currentStageIndex;
            return (
              <div key={stage} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
                      ${isCompleted ? "bg-emerald-500 text-white" : isCurrent ? "bg-al-primary text-white" : "bg-slate-100 text-slate-400"}`}
                    data-testid={`stage-step-${stage}`}
                  >
                    {isCompleted ? <Check size={13} /> : i + 1}
                  </div>
                  <span
                    className={`text-[9px] mt-1 text-center leading-tight max-w-[52px] ${
                      isCurrent
                        ? "text-al-primary font-semibold"
                        : isCompleted
                        ? "text-emerald-600"
                        : "text-slate-400"
                    }`}
                  >
                    {stage.replace(/_/g, " ")}
                  </span>
                </div>
                {i < STAGES.length - 1 && (
                  <div
                    className={`h-px w-4 mx-1 mt-[-10px] ${isCompleted ? "bg-emerald-400" : "bg-slate-200"}`}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Agreed price */}
      {offer && (
        <div className={cn(CARD, "p-5 mb-6")} data-testid="agreed-price-section">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.14em] mb-3">
            Agreed Price
          </p>
          <p className={cn("text-3xl mb-3", FIGURE)}>
            ${(offer.otdPriceCents / 100).toLocaleString()} <span className="text-lg text-slate-400">OTD</span>
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Vehicle</dt>
            <dd className="text-slate-900 font-mono tabular-nums">${(offer.vehiclePriceCents / 100).toLocaleString()}</dd>
            <dt className="text-slate-500">Tax</dt>
            <dd className="text-slate-900 font-mono tabular-nums">${(offer.taxCents / 100).toLocaleString()}</dd>
            <dt className="text-slate-500">Fees</dt>
            <dd className="text-slate-900 font-mono tabular-nums">${(offer.feesCents / 100).toLocaleString()}</dd>
            {offer.includesFinancing && offer.aprRate != null && offer.termMonths != null && (
              <>
                <dt className="text-slate-500">Financing</dt>
                <dd className="text-slate-900 font-mono tabular-nums">{offer.aprRate.toFixed(2)}% / {offer.termMonths} mo</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {/* Contract Shield (read-only) */}
      {(deal.contractShieldStatus || deal.contractShieldScore != null) && (
        <div className={cn(CARD, "p-5 mb-6")} data-testid="contract-shield-status">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
            Contract Shield review (read-only)
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {deal.contractShieldStatus && (
              <Badge variant="secondary">{deal.contractShieldStatus}</Badge>
            )}
            {deal.contractShieldScore != null && (
              <span className="text-sm text-slate-700">
                Score: <span className="font-mono tabular-nums font-semibold">{deal.contractShieldScore}</span>
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Reviewed by AutoLenis. You&apos;ll be notified when the review completes.
          </p>
        </div>
      )}

      {/* Document Upload */}
      <div className={cn(CARD, "p-5 mb-6")} data-testid="document-upload-section">
        <p className="text-sm font-semibold text-slate-800 mb-3">Documents</p>
        <Button href="/dealer/contracts" variant="secondary" className="text-sm min-h-[44px]">
          Manage contracts & documents
        </Button>
      </div>

      {/* Buyer Contact */}
      <div className={cn(CARD, "p-5")} data-testid="buyer-contact-section">
        <p className="text-sm font-semibold text-slate-800 mb-3">Buyer Contact</p>
        {contactVisible && buyer ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-500">Name</dt>
            <dd className="text-slate-900 font-medium" data-testid="buyer-name">
              {buyer.firstName} {buyer.lastName}
            </dd>
            {buyer.email && (
              <>
                <dt className="text-slate-500 flex items-center gap-1"><Mail size={12} /> Email</dt>
                <dd>
                  <a
                    href={`mailto:${buyer.email}`}
                    className="text-al-primary hover:underline break-all min-h-[44px] inline-flex items-center"
                    data-testid="buyer-email"
                  >
                    {buyer.email}
                  </a>
                </dd>
              </>
            )}
            {buyer.phone && (
              <>
                <dt className="text-slate-500 flex items-center gap-1"><Phone size={12} /> Phone</dt>
                <dd>
                  <a
                    href={`tel:${buyer.phone}`}
                    className="text-al-primary hover:underline min-h-[44px] inline-flex items-center"
                    data-testid="buyer-phone"
                  >
                    {buyer.phone}
                  </a>
                </dd>
              </>
            )}
            {(buyer.city || buyer.state) && (
              <>
                <dt className="text-slate-500 flex items-center gap-1"><MapPin size={12} /> Location</dt>
                <dd className="text-slate-900">
                  {[buyer.city, buyer.state, buyer.zip].filter(Boolean).join(", ")}
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">
            Buyer identity is revealed here once the deal has been formed. Stay tuned.
          </p>
        )}
      </div>
    </div>
  );
}
