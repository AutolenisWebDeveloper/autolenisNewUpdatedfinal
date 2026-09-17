import Link from "next/link";
import { AlertTriangle, Clock, ShieldAlert, ArrowRight } from "lucide-react";
import { CARD, EYEBROW } from "@/components/ui/patterns/tokens";
import type { ExceptionLineage } from "@/lib/services/operations/exception-lineage.service";

// THE SCREEN A BUYER SEES WHEN SOMETHING HAS GONE WRONG WITH THEIR MONEY OR THEIR CAR.
//
// §8.2 Phase 10 defect (8): "no buyer-facing exception surface exists — the buyer
// portal renders the `queue_items` buyer-visible status." Until this component,
// `queue_items.buyer_visible_status` was WRITTEN for all 58 catalogued exceptions —
// `queue-item.service.ts:188` sets it on every raise — and read by nothing outside
// the catalogue and its own writer. The words a buyer was meant to see existed, in
// the database, for every exception the platform can raise, and no page rendered
// them.
//
// ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────
//
// It does not invent copy. Every line comes from the §26 catalogue through
// `exceptionLineage`, so the buyer, the dealership and Operations read the same
// checkpoint, owner and deadline from one lineage. A component that wrote its own
// phrasing would be the fourth place the same fact is described, which is the defect
// this phase exists to remove rather than repeat.
//
// It does not apologise or speculate. §26 gives each exception a required action and
// a return point; a buyer wants to know whether they must act, who is acting, and by
// when. "We're sorry for the inconvenience" answers none of those.
//
// ── TONE IS DRIVEN BY WHO ACTS, NOT BY SEVERITY ─────────────────────────────
//
// An exception the buyer owns is amber and says so in the second person — they have
// something to do. One AutoLenis owns is slate: it is not the buyer's problem to
// solve, and colouring it red would make a buyer whose deal is simply waiting on us
// feel their purchase is in danger. Overdue is the only red, because that is the only
// state where the promise has actually been missed.

interface Props {
  readonly exceptions: readonly ExceptionLineage[];
  /**
   * True when the lineage read FAILED. Rendered as a visible, honest failure rather
   * than as an empty list — `exceptionLineage` throws for this reason, and a surface
   * that swallowed it would tell a buyer whose deal is stuck that nothing is wrong.
   */
  readonly unavailable?: boolean;
}

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  // Explicit zone and a full date. A bare "in 2 days" is friendlier and useless for
  // a buyer deciding whether to act tonight; a bare time is ambiguous across zones.
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export default function TransactionExceptionPanel({ exceptions, unavailable }: Props) {
  if (unavailable) {
    return (
      <section className={`${CARD} p-5 sm:p-6`} aria-labelledby="exception-panel-heading">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 rounded-lg bg-slate-100 p-2 text-slate-500">
            <ShieldAlert className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h2 id="exception-panel-heading" className="text-sm font-semibold text-slate-900">
              We could not load the status of your purchase
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              This is a problem on our side, not with your deal. Refresh in a moment — if it keeps
              happening, contact us and we will tell you exactly where your purchase stands.
            </p>
          </div>
        </div>
      </section>
    );
  }

  // The empty state is SILENCE, not a green "all clear" card. A buyer with nothing
  // wrong should see their journey, not a panel telling them their journey is fine —
  // and a reassurance panel that renders whenever the list is empty is also what
  // renders when the query silently returns nothing.
  if (exceptions.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="exception-panel-heading">
      <div className="flex items-center gap-2">
        <h2 id="exception-panel-heading" className={EYEBROW}>
          Needs attention
        </h2>
        <span className="text-[11px] font-medium text-slate-400">
          {exceptions.length} open
        </span>
      </div>

      <ul className="space-y-3">
        {exceptions.map((ex) => {
          const buyerActs = ex.owner === "BUYER" || ex.owner === "BUYER_OPERATIONS" || ex.owner === "BUYER_DEALER";
          const tone = ex.overdue
            ? { ring: "border-red-200", chip: "bg-red-50 text-red-700", icon: "bg-red-50 text-red-600" }
            : buyerActs
              ? { ring: "border-amber-200", chip: "bg-amber-50 text-amber-800", icon: "bg-amber-50 text-amber-600" }
              : { ring: "border-slate-200/80", chip: "bg-slate-100 text-slate-600", icon: "bg-slate-100 text-slate-500" };
          const deadline = formatDeadline(ex.deadlineAt);

          return (
            <li key={ex.id} className={`bg-white ${tone.ring} border rounded-2xl shadow-sm p-5 sm:p-6`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 rounded-lg p-2 ${tone.icon}`}>
                  <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                </span>

                <div className="min-w-0 flex-1">
                  {/* The checkpoint — the same words the Ops queue and the dealer surface use. */}
                  <h3 className="text-sm font-semibold text-slate-900">{ex.checkpoint}</h3>

                  {/* The recovery, in the buyer's own terms, from the §26 catalogue. */}
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">{ex.recovery}</p>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ${tone.chip}`}>
                      {buyerActs ? "Your move" : `With ${ex.ownerLabel}`}
                    </span>

                    {deadline && (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {ex.overdue ? "Was due" : "By"} {deadline}
                      </span>
                    )}

                    {ex.escalated && (
                      <span className="inline-flex items-center rounded-full bg-indigo-50 px-2.5 py-1 text-[11px] font-medium text-indigo-700">
                        Escalated — a specialist is on it
                      </span>
                    )}
                  </div>

                  {/* §26's return point: where the transaction resumes. Only shown when the
                      buyer is the one who acts — telling a buyer where a deal resumes when
                      they have nothing to do is noise. */}
                  {buyerActs && ex.returnPoint && (
                    <Link
                      href="/buyer/deal"
                      className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[#0B5FD1] hover:text-[#0A4DB8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B5FD1]/40 focus-visible:ring-offset-2 rounded"
                    >
                      Continue where you left off
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
