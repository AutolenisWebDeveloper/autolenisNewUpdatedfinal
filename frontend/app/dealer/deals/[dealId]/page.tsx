import { requireDealer } from "@/lib/auth/dealer-session";
import { getDealerDealById } from "@/lib/services/dealer/dealer-deals.service";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mail, Phone, MapPin, ArrowLeft, Check } from "lucide-react";
import Link from "next/link";
import { CARD, FIGURE } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { ReaffirmationForm } from "@/components/dealer/ReaffirmationForm";
import { DealerRecapPanel } from "@/components/dealer/DealerRecapPanel";
import { currentRecap } from "@/lib/services/deal/deal-recap.service";
import { secureHandoffPacket } from "@/lib/services/deal/identity-firewall.service";
import { DealExceptionNotice } from "@/components/dealer/DealExceptionNotice";
import { exceptionLineage, type ExceptionLineage } from "@/lib/services/operations/exception-lineage.service";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ dealId: string }>;
}

// PHASE 7 — `DEALER_CONFIRMATION` and `RECAP_PENDING` join the ladder. Without them a deal
// created since Phase 6 sat at index -1 and the whole progress rail read as "not started".
const STAGES = [
  "ACTIVE",
  "DEALER_CONFIRMATION",
  "RECAP_PENDING",
  "FINANCING_PENDING",
  "CONTRACT_PENDING",
  "CONTRACT_REVIEW",
  "CONTRACT_APPROVED",
  "SIGNING_PENDING",
  "SIGNED",
  "PICKUP_SCHEDULED",
  "COMPLETED",
] as const;

/**
 * The offer's stored fee/add-on/incentive JSON, as the form's editable line list. Anything that is
 * not an object with a label is dropped rather than rendered as a blank row — a form that shows a
 * line with no name asks a dealership to confirm something nobody can read.
 */
function toLineItems(value: unknown): Array<{ label: string; amountCents: number | null }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
    .map((item) => ({
      label: typeof item.label === "string" ? item.label : "",
      amountCents: typeof item.amountCents === "number" ? item.amountCents : null,
    }))
    .filter((item) => item.label.length > 0);
}

export default async function DealerDealDetailPage({ params }: Props) {
  const { dealId } = await params;
  const dealer = await requireDealer();

  const deal = await getDealerDealById(dealId, dealer.id);
  if (!deal) notFound();

  const currentStageIndex = STAGES.indexOf(deal.status as typeof STAGES[number]);

  // §8.1 row 10 — the dealer half of the ONE lineage. Same service, same checkpoint
  // and deadline as the buyer's panel and the Ops queue; the audience decides only
  // what may be disclosed, and the allowlist lives server-side so a buyer-owned
  // exception never reaches this page's props at all (§25.1).
  //
  // Scoped to BOTH the deal and this dealer. `getDealerDealById` has already asserted
  // ownership, and passing `dealerId` as well means a row mis-attached to another
  // dealership cannot surface here even if the deal reference were wrong.
  let dealExceptions: ExceptionLineage[] = [];
  let dealExceptionsUnavailable = false;
  try {
    dealExceptions = await exceptionLineage({ audience: "DEALER", dealId: deal.id, dealerId: dealer.id });
  } catch {
    dealExceptionsUnavailable = true;
  }

  // §Stage 10 — the confirmation form, shown only while the window is genuinely open. A form on a
  // stage the deal has left is a dead end, and a dealership that submits into one gets a 409 it
  // cannot act on.
  const reaffirmation =
    deal.status === "DEALER_CONFIRMATION"
      ? await prisma.dealerReaffirmation.findFirst({
          where: { dealId },
          orderBy: { createdAt: "desc" },
          select: { status: true, dueAt: true },
        })
      : null;
  const awaitingConfirmation = reaffirmation?.status === "PENDING";
  const awaitingBuyer = reaffirmation?.status === "MATERIAL_CHANGE_PENDING";

  // §Stage 11 — the recap, the dealership's half. THIS SURFACE DID NOT EXIST: the POST route was
  // built, the dealership's "recap ready" email linked here, and there was nothing on the page to
  // confirm with. §Stage 11's exit needs BOTH confirmations, so every deal that reached this
  // stage stopped at it permanently.
  const recap = deal.status === "RECAP_PENDING" ? await currentRecap(dealId) : null;
  const recapFrozen = recap
    ? (await prisma.queueItem.count({
        where: {
          dealId,
          exceptionCode: "RECAP_DISPUTED",
          status: { in: ["OPEN", "ASSIGNED", "ESCALATED"] },
        },
      })) > 0 &&
      (await prisma.dealRecap.count({ where: { dealId, disputeReason: { not: null } } })) > 2
    : false;

  // §Stage 10's SECURE HANDOFF — "the co-buyer's contact details and the trade packet are
  // released to the dealership". `secureHandoffPacket` is the one gate for all of it, and it had
  // ZERO production callers: the route comment and the confirmation form both told the dealership
  // the trade packet was released "the moment you confirm", and nothing rendered it. A dealership
  // could not appraise the trade it had been promised.
  //
  // The gate is the function itself — it returns null, not a partial object, while the firewall is
  // closed — so this is a straight call rather than a call behind a second predicate that could
  // drift from the first.
  const handoff = await secureHandoffPacket(dealId, dealer.id);
  const offer = deal.offer;
  const buyer = deal.buyer;

  // §25.1, PHASE 7. This read `deal.status !== "PENDING"`, which released the buyer's contact
  // block from award dispatch onward. The service now applies the identity-firewall predicate and
  // returns `buyer: null` with a reason while the firewall is closed, so the page's own test is
  // simply "did the service give me a buyer" — one gate, in one place, rather than a second
  // predicate here that could drift from it.
  const contactVisible = buyer !== null;

  // Next-action CTA — exactly one primary action per stage.
  const nextAction = ((): { label: string; href: string } | null => {
    switch (deal.status) {
      case "CONTRACT_PENDING":
        return { label: "Upload purchase agreement", href: "/dealer/contracts" };
      case "CONTRACT_REVIEW":
        return { label: "Awaiting Contract Shield review", href: "/dealer/contracts" };
      case "CONTRACT_APPROVED":
      case "SIGNING_PENDING":
        // The BUYER signs the purchase contract — the dealer does not sign it.
        // There is no dealer action here; the dealer is awaiting the buyer's
        // signature, after which an executed copy becomes available below.
        return null;
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

      {/* Holds on this deal, above the stage rail — a dealership reading a progress
          bar that has stopped moving needs the reason in the same glance. */}
      {(dealExceptions.length > 0 || dealExceptionsUnavailable) && (
        <div className="mb-6">
          <DealExceptionNotice exceptions={dealExceptions} unavailable={dealExceptionsUnavailable} />
        </div>
      )}

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

      {/* Executed contract copy — available once the BUYER has signed. The dealer
          receives a copy; the dealer does not sign the purchase contract. */}
      {deal.executedContractAvailable && (
        <div className={cn(CARD, "p-5 mb-6")} data-testid="executed-contract-section">
          <p className="text-sm font-semibold text-slate-800 mb-1">Executed purchase contract</p>
          <p className="text-xs text-slate-500 mb-3">
            The buyer has electronically signed. Download your copy of the executed contract.
          </p>
          <Button
            href={`/api/dealer/deals/${deal.id}/contract`}
            variant="secondary"
            className="text-sm min-h-[44px]"
            data-testid="dealer-download-executed"
          >
            Download executed contract
          </Button>
        </div>
      )}

      {/* Document Upload */}
      <div className={cn(CARD, "p-5 mb-6")} data-testid="document-upload-section">
        <p className="text-sm font-semibold text-slate-800 mb-3">Documents</p>
        <Button href="/dealer/contracts" variant="secondary" className="text-sm min-h-[44px]">
          Manage contracts & documents
        </Button>
      </div>

      {/* §Stage 10 — confirm, or wait on the buyer's decision. */}
      {awaitingConfirmation && deal.offer && (
        <ReaffirmationForm
          dealId={deal.id}
          dueAt={reaffirmation?.dueAt ? reaffirmation.dueAt.toISOString() : null}
          accepted={{
            otdPriceCents: deal.offer.otdPriceCents,
            // PRE-FILLED FROM THE OFFER, and these were three hard-coded nulls. The form's own
            // header says the figures are pre-filled "because confirming means saying 'still
            // true'" — with nulls the dealership retyped its own VIN, and one wrong character
            // tripped §10a rule 1: the buyer told "this is a different vehicle from the one you
            // chose", a rejection that cancels the deal, and an SLA failure against the rooftop.
            vin: deal.offer.vin,
            odometer: deal.offer.odometer,
            aprRate: deal.offer.aprRate,
            termMonths: deal.offer.termMonths,
            deliveryTerms: deal.offer.deliveryTerms,
            feeItems: toLineItems(deal.offer.junkFeeItems),
            addOnItems: toLineItems(deal.offer.addOnItems),
            incentiveItems: toLineItems(deal.offer.incentiveItems),
          }}
        />
      )}
      {recap && (
        <div className="mb-6">
          <DealerRecapPanel
            dealId={deal.id}
            version={recap.version}
            lines={recap.itemised?.lines ?? []}
            otdCents={recap.itemised?.otdCents ?? null}
            products={recap.optionalProducts}
            amountFinancedCents={recap.amountFinancedCents}
            financingPath={recap.financingPath}
            dealerConfirmedAt={recap.dealerConfirmedAt ? recap.dealerConfirmedAt.toISOString() : null}
            buyerConfirmedAt={recap.buyerConfirmedAt ? recap.buyerConfirmedAt.toISOString() : null}
            disputeReason={recap.disputeReason}
            frozen={recapFrozen}
          />
        </div>
      )}

      {handoff?.trade && (
        <div className={cn(CARD, "p-5 mb-6")} data-testid="dealer-trade-packet">
          <p className="text-sm font-semibold text-slate-800 mb-1">Trade-in packet</p>
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            Released with this deal. The trade remains subject to your own inspection and appraisal.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-500">Vehicle</dt>
            <dd className="text-slate-900 font-medium" data-testid="trade-vehicle">
              {[handoff.trade.year, handoff.trade.make, handoff.trade.model, handoff.trade.trim]
                .filter(Boolean)
                .join(" ")}
            </dd>
            {handoff.trade.vin && (
              <>
                <dt className="text-slate-500">VIN</dt>
                <dd className="text-slate-900" data-testid="trade-vin">{handoff.trade.vin}</dd>
              </>
            )}
            {handoff.trade.mileage != null && (
              <>
                <dt className="text-slate-500">Mileage</dt>
                <dd className="text-slate-900">{handoff.trade.mileage.toLocaleString("en-US")}</dd>
              </>
            )}
            {handoff.trade.lienholderName && (
              <>
                <dt className="text-slate-500">Lienholder</dt>
                <dd className="text-slate-900" data-testid="trade-lienholder">{handoff.trade.lienholderName}</dd>
              </>
            )}
            {handoff.trade.verifiedPayoffCents != null && (
              <>
                <dt className="text-slate-500">Verified payoff</dt>
                <dd className="text-slate-900 tabular-nums" data-testid="trade-payoff">
                  ${(handoff.trade.verifiedPayoffCents / 100).toLocaleString("en-US")}
                  {handoff.trade.payoffGoodThroughDate
                    ? ` — good through ${handoff.trade.payoffGoodThroughDate.toDateString()}`
                    : ""}
                </dd>
              </>
            )}
            <dt className="text-slate-500">Title</dt>
            <dd className="text-slate-900">
              {handoff.trade.titleInHand === true
                ? `In hand${handoff.trade.titleState ? ` (${handoff.trade.titleState})` : ""}`
                : handoff.trade.titleInHand === false
                  ? "Not in hand"
                  : "Not stated"}
            </dd>
            <dt className="text-slate-500">Second key</dt>
            <dd className="text-slate-900">
              {handoff.trade.hasSecondKey === true ? "Yes" : handoff.trade.hasSecondKey === false ? "No" : "Not stated"}
            </dd>
          </dl>
          {handoff.trade.photoUrls.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-2" data-testid="trade-photos">
              {handoff.trade.photoUrls.map((url, i) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-h-[44px] items-center rounded-md border border-slate-300 px-3 text-sm text-slate-700 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
                  >
                    Photo {i + 1}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {handoff?.coBuyer && (
        <div className={cn(CARD, "p-5 mb-6")} data-testid="dealer-cobuyer">
          <p className="text-sm font-semibold text-slate-800 mb-1">Co-buyer</p>
          <p className="text-sm text-slate-600 leading-relaxed mb-3">
            {handoff.coBuyer.isRequiredSigner
              ? "A required signer on this deal."
              : "Named on this deal but not a required signer."}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-500">Name</dt>
            <dd className="text-slate-900 font-medium" data-testid="cobuyer-name">
              {[handoff.coBuyer.legalFirstName, handoff.coBuyer.legalLastName].filter(Boolean).join(" ") || "—"}
            </dd>
            {handoff.coBuyer.email && (
              <>
                <dt className="text-slate-500">Email</dt>
                <dd className="text-slate-900 break-all" data-testid="cobuyer-email">{handoff.coBuyer.email}</dd>
              </>
            )}
            {handoff.coBuyer.phone && (
              <>
                <dt className="text-slate-500">Phone</dt>
                <dd className="text-slate-900" data-testid="cobuyer-phone">{handoff.coBuyer.phone}</dd>
              </>
            )}
          </dl>
        </div>
      )}

      {awaitingBuyer && (
        <div className={cn(CARD, "p-5")} data-testid="reaffirmation-awaiting-buyer">
          <p className="text-sm font-semibold text-slate-800">Waiting on the buyer</p>
          <p className="mt-1 text-sm text-slate-600 leading-relaxed">
            You confirmed with a change from the offer they accepted, so the buyer is deciding
            whether to accept it. We will tell you either way — there is nothing for you to do.
          </p>
        </div>
      )}

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
          <p className="text-sm text-slate-500" data-testid="buyer-contact-withheld">
            {deal.identityWithheldReason === "NOT_REAFFIRMED"
              ? "The buyer's contact details, the co-buyer and the trade packet are released to you the moment you confirm this deal — and not before."
              : deal.identityWithheldReason === "REVOKED"
                ? "This deal is no longer active, so the buyer's details are no longer shown here."
                : "Buyer details are not available for this deal."}
          </p>
        )}
      </div>
    </div>
  );
}
