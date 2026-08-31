import type { Metadata } from "next";

export const metadata: Metadata = { title: "Vehicle Pickup", robots: { index: false, follow: false } };

import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Button } from "@/components/ui/button";
import { MapPin, QrCode, CheckCircle2, FileSignature, Clock, Hourglass, LifeBuoy } from "lucide-react";
import PickupScheduleForm from "@/components/buyer/PickupScheduleForm";
import PickupRescheduleButton from "@/components/buyer/PickupRescheduleButton";
import PickupCounterClient from "@/components/buyer/PickupCounterClient";
import { resolveDealerAvailability } from "@/lib/services/pickup/availability.service";

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
    include: { pickup: true, eSignEnvelope: true, offer: { select: { dealerId: true } } },
    orderBy: { createdAt: "desc" },
  });

  const pickup = deal?.pickup;
  const status = pickup?.status;
  const eSignCompleted = deal?.eSignEnvelope?.status === "COMPLETED";
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

  const now = new Date();
  const expiresAt = pickup?.qrExpiresAt ? new Date(pickup.qrExpiresAt) : null;
  const isExpired = expiresAt ? expiresAt < now : false;
  const isExpiringSoon = expiresAt && !isExpired ? expiresAt.getTime() - now.getTime() < 24 * 60 * 60 * 1000 : false;

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
                Pick a time that works for you — the dealership will confirm it or suggest an alternative. Your QR code is issued once the time is confirmed.
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

      /* ── Buyer proposed → waiting on the dealership ───────────────────────── */
      ) : status === "PROPOSED" ? (
        <div className="bg-al-surface border border-al-border rounded-al-lg p-6 shadow-al-1" data-testid="pickup-proposed">
          <div className="flex items-center gap-2 mb-2">
            <Hourglass size={18} className="text-al-warning" aria-hidden="true" />
            <h2 className="font-display text-lg font-semibold text-al-text">Waiting for the dealership</h2>
          </div>
          <p className="text-sm text-al-text-muted">
            You proposed <span className="font-medium text-al-text">{fmt(pickup?.proposedTime)}</span>. The dealership will confirm it or suggest another time — we&apos;ll let you know as soon as they respond.
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

          {hasDealer && pickup?.qrCodeImage && (
            <div className="text-center bg-al-surface border border-al-border rounded-al-lg p-8 mb-6" data-testid="pickup-qr-code">
              <QrCode size={32} className="text-al-primary mx-auto mb-3" />
              <p className="text-sm text-al-text-muted mb-4">Present this QR code at the lot</p>
              <img src={pickup.qrCodeImage} alt="Pickup QR Code" className="mx-auto max-w-[200px]" />
              {expiresAt && (
                <p className={`text-xs font-medium mt-2 ${isExpired ? "text-al-danger" : isExpiringSoon ? "text-al-warning" : "text-al-success"}`}>
                  {isExpired && "⚠ QR code expired"}
                  {isExpiringSoon && `⚠ QR code expires soon: ${expiresAt.toLocaleString()}`}
                  {!isExpired && !isExpiringSoon && `✓ Valid until ${expiresAt.toLocaleDateString()}`}
                </p>
              )}
              {isExpired && (
                <a href="/buyer/messages" data-testid="qr-expired-contact-support" className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-al-primary hover:text-al-primary-hover transition-colors">
                  Message support to regenerate →
                </a>
              )}
            </div>
          )}

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
