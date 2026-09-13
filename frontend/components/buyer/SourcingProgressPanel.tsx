// S6-30 — the buyer's view of sourcing, as a panel on the request they already have open.
//
// NOT A NEW PAGE, deliberately. §Stage 6's buyer-facing requirement is about the request the
// buyer is watching, and `/buyer/requests/[requestId]` is already where they watch it — it
// carries the status badge, the elections, the financing summary and the update timeline. A
// second "sourcing status" destination would be a competing navigation system for one request,
// which the information-architecture rule forbids and which buyers experience as two pages that
// sometimes disagree.
//
// A SERVER COMPONENT WITH NO CLIENT STATE. Everything here is derived from the case row at
// request time; nothing polls, and nothing needs to. The one interactive element is a link to
// the authorisation screen, which is where the decision and its confirmation live.
//
// THE IDENTITY FIREWALL IS THE REASON FOR THE PROP SHAPE. This component is handed a
// `BuyerSourcingView` and nothing else — a type with no field that can hold a dealership name,
// a dealer id, an email or a per-rooftop distance. §25.1's firewall is built in this phase and
// lifted in Phase 7, and a buyer-facing sourcing panel is the first place it would leak.
// Counts and radii only, and the type is what enforces it rather than this comment.

import Link from "next/link";
import { Check, Circle, Loader2, MapPin, Phone, ShieldCheck } from "lucide-react";
import { CARD, EYEBROW } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
import type { BandRung, BuyerSourcingView } from "@/lib/services/sourcing/sourcing-buyer-view";

function RungRow({ rung }: { rung: BandRung }) {
  const done = rung.state === "DONE";
  const current = rung.state === "CURRENT";
  const needsAuth = rung.state === "NEEDS_AUTHORIZATION";

  return (
    <li
      className="flex items-center gap-3 py-2"
      data-testid={`sourcing-rung-${rung.band}`}
      data-state={rung.state}
    >
      <span
        className={cn(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
          done && "bg-emerald-50 text-emerald-600",
          current && "bg-[#EFF6FF] text-[#0B5FD1]",
          needsAuth && "bg-amber-50 text-amber-600",
          rung.state === "PENDING" && "bg-slate-100 text-slate-400",
        )}
        aria-hidden="true"
      >
        {done ? (
          <Check size={13} strokeWidth={3} />
        ) : current ? (
          <Loader2 size={13} className="animate-spin" />
        ) : needsAuth ? (
          <ShieldCheck size={13} />
        ) : (
          <Circle size={9} />
        )}
      </span>
      <span
        className={cn(
          "text-sm",
          done && "text-slate-500",
          current && "font-semibold text-slate-900",
          needsAuth && "font-semibold text-amber-900",
          rung.state === "PENDING" && "text-slate-400",
        )}
      >
        {rung.label}
      </span>
      {/* The state is announced in text as well as colour: a colour-only status is invisible to
          a screen reader and to a buyer who cannot distinguish the two blues. */}
      <span className="sr-only">
        {done
          ? "searched"
          : current
            ? "searching now"
            : needsAuth
              ? "needs your authorisation"
              : "not searched yet"}
      </span>
    </li>
  );
}

export default function SourcingProgressPanel({
  view,
  requestId,
}: {
  view: BuyerSourcingView;
  requestId: string;
}) {
  return (
    <section
      className={cn(CARD, "mb-6 p-5")}
      data-testid="sourcing-progress-panel"
      data-status-awaiting-buyer={view.awaitingBuyerAuthorization ? "true" : "false"}
      aria-labelledby="sourcing-progress-heading"
    >
      <p className={EYEBROW}>Sourcing</p>
      <h2
        id="sourcing-progress-heading"
        className="mt-2 text-base font-semibold text-slate-900"
        data-testid="sourcing-headline"
      >
        {view.headline}
      </h2>
      <p className="mt-1 text-sm text-slate-600" data-testid="sourcing-detail">
        {view.detail}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 border-y border-slate-100 py-3">
        <div>
          <p className="text-xs text-slate-400">Dealerships competing</p>
          <p className="font-mono text-lg font-bold tabular-nums text-slate-900" data-testid="sourcing-competing-count">
            {view.competingCount}
          </p>
        </div>
        <div>
          <p className="flex items-center gap-1 text-xs text-slate-400">
            <MapPin size={11} aria-hidden="true" /> Searching within
          </p>
          <p className="font-mono text-lg font-bold tabular-nums text-slate-900" data-testid="sourcing-radius">
            {view.searchingMiles === null ? "—" : `${view.searchingMiles} mi`}
          </p>
        </div>
      </div>

      {/* THE SECOND COUNT, KEPT SEPARATE. A rooftop our automated rail cannot email is not a
          dealership competing, and adding it to the figure above would make "6 competing" mean
          "4 were invited and 2 are on a call list". The owner's 2026-09-11 channel ruling is
          that the two counts are recorded separately; this is that, on the buyer's side. */}
      {view.callOnlyCount > 0 && (
        <p
          className="mt-3 flex items-start gap-2 text-xs text-slate-500"
          data-testid="sourcing-call-only-count"
        >
          <Phone size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            {view.callOnlyCount === 1
              ? "1 more dealership can only be reached by phone; our team is contacting them directly and they are not counted above."
              : `${view.callOnlyCount} more dealerships can only be reached by phone; our team is contacting them directly and they are not counted above.`}
          </span>
        </p>
      )}

      <ol className="mt-4 divide-y divide-slate-50" data-testid="sourcing-ladder">
        {view.rungs.map((rung) => (
          <RungRow key={rung.band} rung={rung} />
        ))}
      </ol>

      {view.awaitingBuyerAuthorization && (
        <div
          className="mt-4 rounded-xl border-2 border-amber-200 bg-amber-50 p-4"
          data-testid="radius-authorization-prompt"
        >
          <p className="text-sm font-semibold text-amber-900">Widen the search?</p>
          <p className="mt-0.5 text-sm text-amber-800">
            We will not search past 250 miles without your authorisation, and we will not spend
            anything further until you decide.
          </p>
          <Link
            href={`/buyer/requests/${requestId}/radius`}
            data-testid="authorize-radius-btn"
            className="mt-3 inline-flex h-10 items-center gap-2 rounded-lg bg-al-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-al-primary-hover"
          >
            Review and decide
          </Link>
        </div>
      )}
    </section>
  );
}
