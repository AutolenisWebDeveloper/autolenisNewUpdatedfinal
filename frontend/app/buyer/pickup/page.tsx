import type { Metadata } from "next";

export const metadata: Metadata = { title: "Vehicle Pickup", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { MapPin, CheckCircle2, FileSignature, Clock, Hourglass, LifeBuoy } from "lucide-react";
import PickupScheduleForm from "@/components/buyer/PickupScheduleForm";
import PickupRescheduleButton from "@/components/buyer/PickupRescheduleButton";
import PickupCounterClient from "@/components/buyer/PickupCounterClient";
import PickupReleaseCode from "@/components/buyer/PickupReleaseCode";
import PickupPossessionForm from "@/components/buyer/PickupPossessionForm";
import FundingClearanceChecklist from "@/components/buyer/FundingClearanceChecklist";
import { evaluatePickupReadiness } from "@/lib/services/pickup/pickup-readiness.service";
import { resolveDealerAvailability } from "@/lib/services/pickup/availability.service";
import { allSignedFrom, requiredKindsFrom } from "@/lib/services/esign/required-signers";
import { BUYER_SAFE_ENVELOPE_SELECT } from "@/lib/services/esign/esign-schema-gate";
import { PICKUP_SAFE_SELECT } from "@/lib/services/pickup/pickup-select";

export const dynamic = "force-dynamic";

// Pickup times are shown in the dealership's timezone (Server Components run in
// UTC on Vercel, so an unqualified toLocaleString would display UTC).
function makeFmt(timeZone: string, label: string) {
  return (d: Date | null | undefined): string =>
    d
      ? `${d.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })} ${label}`
      : "—";
}

export default async function PickupPage() {
  const buyer = await requireBuyer();
  const deal = await prisma.deal.findFirst({
    where: { buyerId: buyer.id },
    include: { pickup: { select: PICKUP_SAFE_SELECT }, eSignEnvelopes: { select: BUYER_SAFE_ENVELOPE_SELECT }, coBuyer: { select: { isRequiredSigner: true } }, offer: { select: { dealerId: true } } },
    orderBy: { createdAt: "desc" },
  });

  const pickup = deal?.pickup;
  const status = pickup?.status;
    // §13-D30 RE-DERIVED. The page must agree with the server gate in
  // app/api/buyer/pickup/[dealId]/route.ts, which requires EVERY required signer — a page
  // that offers scheduling the API then refuses is worse than one that never offered it.
  const eSignCompleted = allSignedFrom(deal?.eSignEnvelopes, requiredKindsFrom(deal?.coBuyer));
  const availability = await resolveDealerAvailability(deal?.offer?.dealerId ?? null);
  const hint = {
    minLeadTimeHours: availability.minLeadTimeHours,
    maxAdvanceDays: availability.maxAdvanceDays,
    openHour: availability.openHour,
    closeHour: availability.closeHour,
    days: availability.days,
    timezoneLabel: availability.timezoneLabel,
  };
  const fmt = makeFmt(availability.timezone, availability.timezoneLabel);

  // The QR expiry that used to be computed here came from the companion column of the stored QR
  // image. Both are gone (migration 20261201000000): the credential is minted on demand and
  // carries its own expiry, which PickupReleaseCode shows from the mint response. A second expiry
  // read from a column nothing writes any more would always have said "never".

  // §STAGE 16, ON THE SCREEN THE BUYER ACTUALLY LOOKS AT. The thirteen readiness items are
  // derived, never stored, so this is a read — and it is only rendered while the pickup is not
  // yet agreed, because once a time is confirmed the list has served its purpose and a
  // thirteen-row checklist above a confirmed appointment is noise.
  //
  // Evaluated only when there is something to evaluate: a deal that has not reached scheduling
  // at all would show thirteen outstanding rows for a handover nobody has asked for yet.
  const readiness =
    deal && (deal.status === "FUNDING_PENDING" || deal.status === "PICKUP_READINESS")
      ? await evaluatePickupReadiness(deal.id)
      : null;

  const noOpenPickup = !pickup || status === "NOT_SCHEDULED";
  const isConfirmed = status === "SCHEDULED" || status === "RESCHEDULED" || status === "CHECKED_IN";
  // A concierge (vehicle-request) deal has no Offer, and VehicleRequestOffer carries
  // no dealer identity — so there is no dealership to confirm a proposed time and no
  // dealer account that can scan the pickup QR. Those flows are dealer-only; a
  // dealer-less pickup is coordinated and completed by the AutoLenis concierge team.
  // Showing the dealer flow here would promise a counterparty that does not exist.
  const hasDealer = !!deal?.offer?.dealerId;

  return (
    <div className="p-6 md:p-8 max-w-xl" data-testid="pickup-page">
      <div className="flex items-center gap-3 mb-6">
        <MapPin size={24} className="text-al-primary" />
        <h1 className="text-xl font-bold text-al-text">Vehicle Pickup</h1>
      </div>

      {/* §Stage 16: "the website shows the exact unresolved item and the party responsible for
          it". Above the scheduling controls, because an unmet item is the reason those controls
          will refuse — a buyer who proposes a time and is told "not ready" without being told
          WHAT is not ready has learned nothing. */}
      {readiness && !readiness.ready && (
        <div className="mb-6">
          <FundingClearanceChecklist
            items={readiness.items}
            clear={readiness.ready}
            heading="Before we can book your pickup"
            intro="Your vehicle is nearly ready. These are the checks that have to be complete before a handover can be scheduled — most of them are never yours."
            clearedLabel="Ready to schedule"
            testId="pickup-readiness-checklist"
          />
        </div>
      )}

      {/* ── No open pickup: propose a time (dealer confirms) ─────────────────── */}
      {noOpenPickup ? (
        <div data-testid="pickup-not-scheduled">
          {eSignCompleted && deal && !hasDealer ? (
            <div className="bg-al-surface border border-al-border rounded-al-lg p-6 shadow-al-1" data-testid="pickup-concierge-coordinated">
              <h2 className="font-display text-lg font-semibold text-al-text mb-1">Your concierge is arranging pickup</h2>
              <p className="text-sm text-al-text-muted mb-5">
                This vehicle was sourced by our concierge team rather than through a dealership on the platform, so we
                coordinate the handover for you directly. We&apos;ll reach out to confirm a time that works — no action
                needed from you right now.
              </p>
              <Button href="/buyer/messages" variant="secondary" size="sm">Message your concierge</Button>
            </div>
          ) : eSignCompleted && deal ? (
            <div className="bg-al-surface border border-al-border rounded-al-lg p-6 shadow-al-1" data-testid="pickup-schedule-container">
              <h2 className="font-display text-lg font-semibold text-al-text mb-1">Propose a pickup time</h2>
              <p className="text-sm text-al-text-muted mb-5">
                Pick a time that works for you — the dealership will confirm it or suggest an alternative. When it&apos;s confirmed, you&apos;ll show a pickup code from this page at the dealership.
              </p>
              <PickupScheduleForm dealId={deal.id} availability={availability} />
            </div>
          ) : (
            <div className="flex flex-col items-center text-center bg-al-surface border border-al-border rounded-al-lg p-10" data-testid="pickup-blocked-unsigned">
              <FileSignature size={28} className="text-al-text-subtle mb-3" aria-hidden="true" />
              <h2 className="font-display text-base font-semibold text-al-text mb-1">Almost there</h2>
              <p className="text-sm text-al-text-muted max-w-sm mb-5">
                Pickup scheduling opens as soon as your documents are signed. Finish signing and this step unlocks automatically.
              </p>
              <Button href="/buyer/esign" variant="secondary" size="sm">Go to signing</Button>
            </div>
          )}
        </div>

      /* ── Completed ────────────────────────────────────────────────────────── */
      ) : status === "COMPLETED" ? (
        <div className="text-center" data-testid="pickup-completed">
          <CheckCircle2 size={48} className="text-al-success mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-al-text mb-2">Pickup complete!</h2>
          <p className="text-al-text-muted text-sm mb-6">Your vehicle has been picked up. Enjoy your new car!</p>
          <Button href={`/buyer/deal/${deal?.id}/complete`} data-testid="view-deal-complete-btn">View Deal Summary</Button>
        </div>

      /* ── Released by the dealership → the buyer confirms possession ────────── */
      ) : deal?.status === "HANDOVER_PENDING" ? (
        // §Stage 19. The form is keyed on the DEAL's status rather than the pickup's, because
        // that is what `confirmPossession` gates on — a page that offered the form on a pickup
        // the service would refuse is worse than one that never offered it.
        <PickupPossessionForm dealId={deal.id} vin={deal.vin} />

      /* ── Buyer proposed → waiting on the dealership ───────────────────────── */
      ) : status === "PROPOSED" ? (
        <div className="bg-al-surface border border-al-border rounded-al-lg p-6 shadow-al-1" data-testid="pickup-proposed">
          <div className="flex items-center gap-2 mb-2">
            <Hourglass size={18} className="text-al-warning" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-al-text">
              {hasDealer ? "Waiting for the dealership" : "Your concierge is confirming"}
            </h2>
          </div>
          {/* A dealer-less deal can only have reached PROPOSED before concierge
              deals were excluded from the dealer round-trip. No dealership will
              ever respond to it, so don't promise one. */}
          <p className="text-sm text-al-text-muted">
            You proposed <span className="font-medium text-al-text">{fmt(pickup?.proposedTime)}</span>.{" "}
            {hasDealer
              ? "The dealership will confirm it or suggest another time — we'll let you know as soon as they respond."
              : "Our concierge team is confirming the handover directly and will be in touch shortly."}
          </p>
        </div>

      /* ── Dealer countered → buyer accepts or proposes another ─────────────── */
      ) : status === "DEALER_COUNTERED" ? (
        <div className="bg-al-surface border border-al-border rounded-al-lg p-6 shadow-al-1" data-testid="pickup-countered">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={18} className="text-al-primary" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-al-text">The dealership proposed a new time</h2>
          </div>
          <p className="text-sm text-al-text-muted mb-4">
            Suggested pickup: <span className="font-medium text-al-text">{fmt(pickup?.proposedTime)}</span>. Accept it, or propose another time that works for you.
          </p>
          {pickup?.proposedAt && deal && (
            <PickupCounterClient dealId={deal.id} proposedAt={pickup.proposedAt.toISOString()} availability={hint} />
          )}
        </div>

      /* ── Escalated to AutoLenis ──────────────────────────────────────────── */
      ) : status === "EXCEPTION" ? (
        <div className="bg-al-surface border border-al-border rounded-al-lg p-6 shadow-al-1 text-center" data-testid="pickup-exception">
          <LifeBuoy size={28} className="text-al-primary mx-auto mb-3" aria-hidden="true" />
          <h2 className="font-display text-base font-semibold text-al-text mb-1">We&apos;re finalizing your pickup time</h2>
          <p className="text-sm text-al-text-muted max-w-sm mx-auto mb-5">
            After a few rounds, our concierge team is stepping in to lock in a pickup time with the dealership. We&apos;ll reach out shortly.
          </p>
          <Button href="/buyer/messages" variant="secondary" size="sm">Message support</Button>
        </div>

      /* ── Confirmed (SCHEDULED / RESCHEDULED / CHECKED_IN) → QR + reschedule ── */
      ) : isConfirmed ? (
        <div>
          {pickup?.scheduledAt && (
            <div className="bg-al-primary/5 border border-al-primary/20 rounded-al-lg p-5 mb-6" data-testid="pickup-scheduled">
              <p className="text-sm font-semibold text-al-text">Scheduled pickup</p>
              <p className="text-lg font-bold text-al-primary mt-1">{fmt(pickup.scheduledAt)}</p>
              {pickup.location && <p className="text-sm text-al-text-muted mt-0.5">{pickup.location}</p>}
            </div>
          )}

          {/* The QR is a DEALER credential — it is completed by a dealer scanning it.
              A concierge pickup has no dealership, so presenting it would be a
              dead end; the concierge team confirms that handover instead. */}
          {!hasDealer && (
            <div className="bg-al-surface border border-al-border rounded-al-lg p-6 mb-6" data-testid="pickup-concierge-handover">
              <p className="text-sm font-semibold text-al-text mb-1">Concierge-coordinated handover</p>
              <p className="text-sm text-al-text-muted">
                Your concierge confirms this handover directly — there&apos;s no dealership code to present. We&apos;ll
                mark your deal complete once the vehicle is with you.
              </p>
            </div>
          )}

          {/* The code is REVEALED, not rendered from a column — see PickupReleaseCode. This
              branch is already the confirmed one (SCHEDULED / RESCHEDULED / CHECKED_IN), which is
              exactly the set the reveal route will mint for; the route re-checks it server-side
              and names the state it found if it has moved since this page rendered. The "message
              support to regenerate" escape hatch goes with the stored image — an expired code is
              now replaced by revealing again. */}
          {hasDealer && <PickupReleaseCode dealId={deal!.id} />}

          {(status === "SCHEDULED" || status === "RESCHEDULED") && (
            <PickupRescheduleButton dealId={deal!.id} currentDate={pickup?.scheduledAt?.toISOString() ?? ""} location={pickup?.location ?? ""} />
          )}

          {hasDealer && (
            <p className="text-xs text-al-text-subtle text-center">Your pickup QR code is unique and single-use.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
