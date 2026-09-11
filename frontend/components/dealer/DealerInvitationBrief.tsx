// S7-13 — the invitation brief a dealership sees, with no buyer identity in it.
//
// THE PROP TYPE IS THE FIREWALL. §25.1 holds from invitation until the Phase 7 reaffirmation
// lift, and there is no prop here that can carry a buyer's name, email, phone, street address,
// exact ZIP, budget ceiling, deposit or prequalification — so a future edit cannot pass one
// through by accident and a reviewer can confirm the guarantee by reading the interface. The
// generalLocation is a city/state string, which is what the invitation email already carries.
//
// A SERVER COMPONENT WITH ONE CLIENT ISLAND. The brief itself renders on the server — the
// criteria are never serialised into a client payload — and the only stateful control, the
// decline confirmation, is its own client component. Keeping the split that way is what lets the
// criteria stay server-rendered while the one thing that needs state has it.
//
// FIVE STATES, AND EACH ONE TELLS A REAL DEALERSHIP SOMETHING DIFFERENT. A single "this link is
// invalid" page would be cheaper and would waste a dealership's time: "a newer invitation was
// sent to you" and "this auction has closed" call for opposite responses, and a dealership that
// cannot tell them apart emails Operations instead of bidding.

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock,
  Lock,
  MapPin,
  XCircle,
} from "lucide-react";
import { CARD, EYEBROW } from "@/components/ui/patterns";
import DeclineInvitationButton from "./DeclineInvitationButton";
import { cn } from "@/lib/utils";
import type { InvitationTokenRejection } from "@/lib/services/auction/auction-invitation.service";

export interface InvitationCriteria {
  yearMin: number | null;
  yearMax: number | null;
  make: string | null;
  model: string | null;
  requiredFeatures: string[];
  preferredFeatures: string[];
  maxMileage: number | null;
  tradeIndicated: boolean;
  deliveryPreference: string | null;
}

interface Props {
  invitationId: string;
  auctionId: string;
  /** Null when the invitation row carries no name — addressed neutrally rather than invented. */
  dealershipName: string | null;
  contactName: string | null;
  rejection: InvitationTokenRejection | null;
  alreadyBid: boolean;
  endsAt: string | null;
  /** City and state only. Never the exact ZIP or a street. */
  generalLocation: string | null;
  criteria: InvitationCriteria | null;
  signedIn: boolean;
  /** True only when the session's dealer or rooftop matches THIS invitation. */
  authorized: boolean;
  signInHref: string;
}

const REJECTION_COPY: Record<InvitationTokenRejection, { heading: string; body: string }> = {
  NOT_FOUND: {
    heading: "This invitation link is not one we recognise",
    body: "Check that the whole link was copied from the email. If it still does not work, reply to the invitation and our team will reissue it.",
  },
  TOKEN_EXPIRED: {
    heading: "This invitation has expired",
    body: "An invitation link lasts as long as the auction it belongs to, and this auction's window has passed. Nothing was lost on your side — you will be invited to the next request that matches your inventory.",
  },
  AUCTION_NOT_ACTIVE: {
    heading: "This auction has closed",
    body: "Offers are no longer being accepted. If you submitted one before it closed, it still stands and you will hear the outcome.",
  },
  INVITATION_SUPERSEDED: {
    heading: "A newer invitation was sent to you",
    body: "This link was replaced — usually because the first email bounced or the contact for your rooftop changed. Use the most recent invitation email instead.",
  },
  ALREADY_DECLINED: {
    heading: "You declined this invitation",
    body: "No further reminders will be sent for this auction. If that was a mistake, reply to the invitation email and our team can reopen it while the auction is still live.",
  },
};

function yearRange(c: InvitationCriteria): string | null {
  if (c.yearMin && c.yearMax) return c.yearMin === c.yearMax ? `${c.yearMin}` : `${c.yearMin}–${c.yearMax}`;
  if (c.yearMin) return `${c.yearMin} or newer`;
  if (c.yearMax) return `${c.yearMax} or older`;
  return null;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value}</p>
    </div>
  );
}

export default function DealerInvitationBrief({
  invitationId,
  auctionId,
  dealershipName,
  contactName,
  rejection,
  alreadyBid,
  endsAt,
  generalLocation,
  criteria,
  signedIn,
  authorized,
  signInHref,
}: Props) {
  const greeting = contactName ?? dealershipName ?? null;
  const deadline = endsAt ? new Date(endsAt) : null;

  if (rejection) {
    const copy = REJECTION_COPY[rejection];
    return (
      <main
        className="mx-auto max-w-xl p-6 md:p-10"
        data-testid="invitation-rejected"
        data-invitation-id={invitationId}
      >
        <div className={cn(CARD, "p-6")} data-rejection={rejection}>
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            {rejection === "ALREADY_DECLINED" ? (
              <XCircle size={18} aria-hidden="true" />
            ) : (
              <AlertTriangle size={18} aria-hidden="true" />
            )}
          </span>
          <h1 className="mt-4 text-lg font-bold text-slate-900">{copy.heading}</h1>
          <p className="mt-2 text-sm text-slate-600">{copy.body}</p>
          <Link
            href="/dealer/dashboard"
            className="mt-5 inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            data-testid="invitation-rejected-dashboard"
          >
            Go to your dealer portal <ArrowRight size={14} aria-hidden="true" />
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main
      className="mx-auto max-w-xl p-6 md:p-10"
      data-testid="invitation-brief"
      data-invitation-id={invitationId}
    >
      <p className={EYEBROW}>Auction invitation</p>
      <h1 className="mt-2 text-xl font-bold text-slate-900">
        {greeting ? `${greeting} — you are invited to compete` : "You are invited to compete"}
      </h1>
      <p className="mt-1 text-sm text-slate-600">
        A buyer has paid their deposit and we are inviting a small field of dealerships to bid.
        Offers stay sealed: no dealership sees another&apos;s price.
      </p>

      {deadline && (
        <p
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"
          data-testid="invitation-deadline"
        >
          <CalendarClock size={14} className="text-slate-400" aria-hidden="true" />
          Offers close{" "}
          <strong className="font-semibold text-slate-900">
            {deadline.toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </strong>
        </p>
      )}

      {criteria ? (
        <section className={cn(CARD, "mt-5 p-5")} data-testid="invitation-criteria">
          <p className={EYEBROW}>What the buyer is looking for</p>
          <div className="mt-3 grid grid-cols-2 gap-4">
            {criteria.make && <Field label="Make" value={criteria.make} />}
            {criteria.model && <Field label="Model" value={criteria.model} />}
            {yearRange(criteria) && <Field label="Year" value={yearRange(criteria)!} />}
            {criteria.maxMileage !== null && (
              <Field label="Maximum mileage" value={`${criteria.maxMileage.toLocaleString()} mi`} />
            )}
            {generalLocation && (
              <div>
                <p className="flex items-center gap-1 text-xs text-slate-400">
                  <MapPin size={11} aria-hidden="true" /> Buyer area
                </p>
                <p className="text-sm font-medium text-slate-800">{generalLocation}</p>
              </div>
            )}
            {criteria.deliveryPreference && (
              <Field label="Preference" value={criteria.deliveryPreference} />
            )}
          </div>

          {criteria.requiredFeatures.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-400">Must have</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {criteria.requiredFeatures.map((f) => (
                  <span
                    key={f}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
          {criteria.preferredFeatures.length > 0 && (
            <div className="mt-3">
              <p className="text-xs text-slate-400">Nice to have</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {criteria.preferredFeatures.map((f) => (
                  <span key={f} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}
          {criteria.tradeIndicated && (
            <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
              The buyer has indicated a trade-in. Its details are shared with you once you submit
              an offer.
            </p>
          )}

          {/* The firewall, said out loud. A dealership that understands WHY it cannot see the
              buyer does not email Operations to ask for a name. */}
          <p className="mt-4 flex items-start gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
            <Lock size={12} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" />
            <span>
              The buyer&apos;s identity stays private until a deal is agreed. Everything you need to
              price the vehicle is above.
            </span>
          </p>
        </section>
      ) : (
        <section className={cn(CARD, "mt-5 p-5")} data-testid="invitation-criteria-unavailable">
          {/* A QUERY FAILURE RENDERS AS A FAILURE, NEVER AS A CONFIDENT EMPTY. "No criteria" and
              "we could not load the criteria" are different facts, and showing the first when the
              second is true would have a dealership bid on nothing. */}
          <p className="text-sm font-semibold text-slate-900">We could not load the buyer&apos;s criteria</p>
          <p className="mt-1 text-sm text-slate-600">
            The invitation is valid — this is on our side. Open the auction in your portal, or
            reload this page.
          </p>
        </section>
      )}

      {/* THE ACTION, BEHIND A SESSION. §13-D37: the token binds the invitation, the session
          authorises the portal. */}
      <div className="mt-6" data-testid="invitation-action">
        {alreadyBid ? (
          <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-4" data-testid="invitation-already-bid">
            <p className="flex items-center gap-2 text-sm font-semibold text-emerald-900">
              <CheckCircle2 size={15} aria-hidden="true" /> Your offer is in
            </p>
            <p className="mt-1 text-sm text-emerald-800">
              You will hear the outcome when the auction closes. You can revise your offer from your
              portal until then.
            </p>
            <Link
              href={`/dealer/auctions/${auctionId}`}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-al-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-al-primary-hover"
              data-testid="invitation-view-auction"
            >
              View this auction <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        ) : authorized ? (
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={`/dealer/quick-offer/${auctionId}`}
              className="inline-flex h-11 items-center gap-2 rounded-lg bg-al-primary px-5 text-sm font-semibold text-white transition-colors hover:bg-al-primary-hover"
              data-testid="invitation-submit-offer"
            >
              Submit your offer <ArrowRight size={14} aria-hidden="true" />
            </Link>
            {/* Declining is a real, recorded answer: it stops the 50% and 90% reminders. A
                dealership with no way to say no gets two more emails it did not want, which is
                how an invitation rail earns a spam complaint. */}
            <DeclineInvitationButton auctionId={auctionId} />
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" data-testid="invitation-sign-in-required">
            <p className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Clock size={15} className="text-slate-400" aria-hidden="true" /> Sign in to submit
              your offer
            </p>
            <p className="mt-1 text-sm text-slate-600">
              {signedIn
                ? "The account you are signed in with is not the one this invitation was sent to. Sign in as that dealership to bid."
                : "Offers are submitted from your dealer portal, so we know the price came from you and not from whoever is holding this link."}
            </p>
            <Link
              href={signInHref}
              className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-al-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-al-primary-hover"
              data-testid="invitation-sign-in"
            >
              {signedIn ? "Switch account" : "Sign in"} <ArrowRight size={14} aria-hidden="true" />
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
