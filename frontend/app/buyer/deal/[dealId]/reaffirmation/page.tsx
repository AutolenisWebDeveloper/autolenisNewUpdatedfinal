// Buyer — §Stage 10. The dealership's confirmation, the condition disclosure, and any change.
//
// THE COMPLETE STATE SET, designed rather than defaulted. §Stage 10 has more states than "the
// dealership confirmed", and a state with no design is a dead end the moment it fires:
//
//   WAITING        the 24-hour window is open and the dealership has not answered. The buyer sees
//                  the deadline and is told they need do nothing — the commonest state, and the
//                  one most likely to be skipped in a happy-path build.
//   DECIDE         a material change is waiting (§10a). The side-by-side owns the screen.
//   ACKNOWLEDGE    confirmed, disclosure not yet acknowledged. One action.
//   DONE           both done; the deal has moved to recap. The page says where it went rather
//                  than showing a stale form.
//   STOOD DOWN     rejection, timeout, released hold or failed verification. The buyer is told
//                  why and pointed at their remaining offers.
//   AUTO-APPLIED   a lower out-the-door applied in the buyer's favour. Surfaced deliberately:
//                  §10a applies it "automatically", which must not mean "silently".
//
// EDGE CASES THE STATES ABOVE ABSORB, checked rather than assumed:
//   • the 24 hours passing while the buyer is on the page — the cron stands the deal down and a
//     refresh lands on STOOD DOWN with the reason, not on a form that no longer works;
//   • the hold expiring mid-acknowledgement — the acknowledgement still records (it is a fact
//     about the buyer, not about the hold) and the hold notice arrives separately;
//   • a change decided in another tab — the POST returns NO_PENDING_CHANGE and the error state
//     says so rather than appearing to succeed.
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireBuyer } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Clock, CheckCircle2, Info } from "lucide-react";
import { MaterialChangeComparison, type ComparisonDifference } from "@/components/buyer/MaterialChangeComparison";
import { ConditionDisclosureAck } from "@/components/buyer/ConditionDisclosureAck";

export const dynamic = "force-dynamic";

interface Props { params: Promise<{ dealId: string }> }

function money(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

export default async function ReaffirmationPage({ params }: Props) {
  const { dealId } = await params;
  const buyer = await requireBuyer();

  const deal = await prisma.deal.findFirst({
    where: { id: dealId, buyerId: buyer.id },
    select: {
      id: true,
      status: true,
      vin: true,
      otdCentsConfirmed: true,
      vehicleHoldUntil: true,
      conditionDisclosureAcknowledgedAt: true,
      offer: {
        select: {
          otdPriceCents: true,
          vin: true,
          odometer: true,
          vehicleYear: true,
          vehicleMake: true,
          vehicleModel: true,
          vehicleTrim: true,
        },
      },
    },
  });
  if (!deal) notFound();

  const reaffirmation = await prisma.dealerReaffirmation.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
  });

  const proposal = reaffirmation?.materialChangeProposal as
    | { differences?: ComparisonDifference[]; autoApplied?: boolean; savingCents?: number }
    | null
    | undefined;

  const vehicle =
    [deal.offer?.vehicleYear, deal.offer?.vehicleMake, deal.offer?.vehicleModel, deal.offer?.vehicleTrim]
      .filter(Boolean)
      .join(" ") || "your vehicle";

  const stoodDown = deal.status === "CANCELLED" || deal.status === "REFUNDED";
  const awaitingDecision = reaffirmation?.status === "MATERIAL_CHANGE_PENDING";
  const confirmed = reaffirmation?.status === "CONFIRMED";
  const acknowledged = !!deal.conditionDisclosureAcknowledgedAt;
  const movedOn = deal.status !== "DEALER_CONFIRMATION" && !stoodDown;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <nav aria-label="Breadcrumb" className="mb-4 text-[13px]">
        <Link
          href="/buyer/deal"
          className="text-al-text-subtle underline-offset-2 hover:text-al-text hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
        >
          ← Back to my deal
        </Link>
      </nav>

      <h1 className="text-[24px] font-semibold leading-tight text-al-text">Dealership confirmation</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-al-text-muted">
        {vehicle}
        {deal.offer?.otdPriceCents ? ` · ${money(deal.otdCentsConfirmed ?? deal.offer.otdPriceCents)} out the door` : ""}
      </p>

      {/* STOOD DOWN — terminal for this dealership. Said first, because nothing below applies. */}
      {stoodDown && (
        <section
          className="mt-6 rounded-al-lg border border-al-border bg-al-surface px-5 py-5 sm:px-6"
          data-testid="reaffirmation-stood-down"
        >
          <h2 className="text-[17px] font-semibold text-al-text">This deal did not go ahead</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-al-text-muted">
            {reaffirmation?.status === "TIMED_OUT"
              ? "The dealership did not confirm within 24 hours, so we have returned you to the other offers on your auction."
              : "The dealership could not proceed, so we have returned you to the other offers on your auction."}{" "}
            Nothing you have paid is affected.
          </p>
          <Link
            href="/buyer/dashboard"
            className="mt-4 inline-flex min-h-[48px] items-center rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
            data-testid="reaffirmation-see-offers"
          >
            See my other offers
          </Link>
        </section>
      )}

      {/* WAITING — the 24-hour window is open. */}
      {!stoodDown && !confirmed && !awaitingDecision && (
        <section
          className="mt-6 rounded-al-lg border border-al-border bg-al-surface px-5 py-5 sm:px-6"
          data-testid="reaffirmation-waiting"
        >
          <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-al-text-subtle">
            <Clock size={14} aria-hidden="true" />
            Waiting on the dealership
          </p>
          <h2 className="mt-1 text-[19px] font-semibold leading-snug text-al-text">
            The dealership is confirming it can do this deal
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-al-text-muted">
            They have 24 hours to confirm the vehicle is still available, the VIN and mileage, the
            out-the-door amount, every fee and add-on, and how they will handle your registration.
            We remind them at 12 hours.
          </p>
          {reaffirmation?.dueAt && (
            <p className="mt-3 text-[14px] font-medium text-al-text" data-testid="reaffirmation-due-at">
              Due by {reaffirmation.dueAt.toUTCString()}
            </p>
          )}
          <p className="mt-3 text-[14px] leading-relaxed text-al-text-subtle">
            There is nothing for you to do right now. If they do not confirm in time, we return you
            to the other offers on your auction and tell you why.
          </p>
        </section>
      )}

      {/* AUTO-APPLIED — applied automatically must never mean applied silently. */}
      {proposal?.autoApplied === true && (
        <section
          className="mt-6 rounded-al-lg border border-al-success/30 bg-al-success-subtle px-5 py-4 sm:px-6"
          data-testid="reaffirmation-auto-applied"
        >
          <p className="inline-flex items-center gap-2 text-[15px] font-semibold text-al-success-fg">
            <CheckCircle2 size={16} aria-hidden="true" />
            Your price came down by {money(proposal.savingCents ?? 0)}
          </p>
          <p className="mt-1 text-[14px] leading-relaxed text-al-success-fg">
            The dealership lowered the out-the-door amount with nothing else changed, so we applied
            it in your favour automatically. There was nothing for you to approve.
          </p>
        </section>
      )}

      {/* DECIDE — §10a owns the screen when a decision is owed. */}
      {awaitingDecision && (
        <div className="mt-6">
          <MaterialChangeComparison dealId={deal.id} differences={proposal?.differences ?? []} />
        </div>
      )}

      {/* ACKNOWLEDGE — confirmed, disclosure outstanding. */}
      {confirmed && !acknowledged && !stoodDown && (
        <div className="mt-6">
          <ConditionDisclosureAck
            dealId={deal.id}
            artifactUrls={reaffirmation?.disclosureArtifactUrls ?? []}
          />
        </div>
      )}

      {/* DONE — say where the deal went rather than showing a stale form. */}
      {confirmed && acknowledged && (
        <section
          className="mt-6 rounded-al-lg border border-al-success/30 bg-al-surface px-5 py-5 sm:px-6"
          data-testid="reaffirmation-complete"
        >
          <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-al-success-fg">
            <CheckCircle2 size={14} aria-hidden="true" />
            This stage is complete
          </p>
          <h2 className="mt-1 text-[19px] font-semibold leading-snug text-al-text">
            Dealership confirmed and disclosure acknowledged
          </h2>
          <p className="mt-2 text-[15px] leading-relaxed text-al-text-muted">
            {movedOn
              ? "Your final numbers are ready to agree. Both you and the dealership confirm the recap before any paperwork is prepared."
              : "We are preparing your final recap now."}
          </p>
          {movedOn && (
            <Link
              href={`/buyer/deal/${deal.id}/recap`}
              className="mt-4 inline-flex min-h-[48px] items-center rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
              data-testid="reaffirmation-to-recap"
            >
              Review my final numbers
            </Link>
          )}
        </section>
      )}

      {/* The hold is context, never an action for the buyer. §10c is the dealership's decision. */}
      {deal.vehicleHoldUntil && !stoodDown && (
        <p
          className="mt-6 inline-flex items-start gap-2 text-[13px] leading-relaxed text-al-text-subtle"
          data-testid="reaffirmation-hold"
        >
          <Info size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          The dealership is holding this vehicle for you until {deal.vehicleHoldUntil.toUTCString()}.
          If your paperwork is not requested before then, we ask them to extend or release it and
          tell you either way.
        </p>
      )}
    </main>
  );
}
