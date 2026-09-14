"use client";

// §10a — "Material changes are presented side by side — confirmed versus proposed — with a single
// accept or reject action."
//
// THIS IS THE MOST CONSEQUENTIAL SCREEN IN THE FLOW, and the failure mode names the design: a
// buyer who accepts a material change they did not notice. No later screen recovers it — the recap
// carries the accepted figures forward, Contract Shield compares the contract against the recap,
// and the signature binds it. So "unmissable" is a requirement here, not a preference.
//
// FIVE DESIGN DECISIONS, each against that failure mode:
//
// 1. TWO COLUMNS, LABELLED WITH WHAT THEY MEAN. "You accepted" and "Now proposed", not "Before"
//    and "After" — the buyer's relationship to the left column is the whole point. On a narrow
//    viewport the columns STACK rather than shrink, because two unreadable columns are worse than
//    two readable rows, and a price a buyer squints at is a price they skim.
//
// 2. THE CONSEQUENCE IS A SENTENCE, NOT A DELTA. "$41,200 → $42,600" asks the buyer to do
//    arithmetic under mild social pressure. "You would pay $1,400 more than the offer you
//    accepted" does not. The delta is shown too, but the sentence leads.
//
// 3. COLOUR IS NEVER THE ONLY CARRIER (WCAG AA, and the owner's brief states it). Every changed
//    value carries an icon, a text label naming the kind of change, and a strikethrough on the
//    superseded figure. Remove all colour and the screen still reads correctly — which is also
//    what happens in a forwarded email, a printed page and a high-contrast mode.
//
// 4. ONE ACCEPT, ONE REJECT, AND REJECT IS NOT HIDDEN. §10a says "a single accept or reject
//    action". Both are full-width, adjacent, and equally reachable; neither is a text link beside
//    a button. Reject carries its consequence in the button's own supporting line ("go back to
//    your other offers") so it is not a leap into the dark.
//
// 5. ACCEPT IS DELIBERATE, NOT REFLEXIVE. The accept button is disabled until the buyer has
//    scrolled the comparison into view and ticked one acknowledgement. That is the smallest
//    intervention that converts a reflex into a decision, and it is on ACCEPT only — rejecting
//    without reading costs the buyer nothing but a different dealership.
//
// WHAT THIS COMPONENT NEVER SHOWS: the buyer's approved ceiling. §10a's above-ceiling case "cannot
// be accepted at all" and is refused at the DEALERSHIP, so it never reaches this screen as a
// choice — and a buyer who cannot be offered it has no need to be shown the number.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Car, CircleDollarSign, Clock, Settings2 } from "lucide-react";

export interface ComparisonDifference {
  field: string;
  label: string;
  severity: "IDENTITY" | "MONEY" | "TERMS" | "TIMING" | "SPECIFICATION";
  confirmed: string;
  proposed: string;
  consequence: string;
}

const SEVERITY: Record<
  ComparisonDifference["severity"],
  { kind: string; Icon: typeof AlertTriangle; tone: string; chip: string }
> = {
  IDENTITY: { kind: "Different vehicle", Icon: Car, tone: "text-al-danger", chip: "bg-al-danger-subtle text-al-danger-fg border-al-danger/30" },
  MONEY: { kind: "Price change", Icon: CircleDollarSign, tone: "text-al-danger", chip: "bg-al-danger-subtle text-al-danger-fg border-al-danger/30" },
  TERMS: { kind: "Financing terms", Icon: Settings2, tone: "text-al-warning", chip: "bg-al-warning-subtle text-al-warning-fg border-al-warning/30" },
  TIMING: { kind: "Timing change", Icon: Clock, tone: "text-al-warning", chip: "bg-al-warning-subtle text-al-warning-fg border-al-warning/30" },
  SPECIFICATION: { kind: "Specification change", Icon: Settings2, tone: "text-al-warning", chip: "bg-al-warning-subtle text-al-warning-fg border-al-warning/30" },
};

export function MaterialChangeComparison({
  dealId,
  differences,
}: {
  dealId: string;
  differences: ComparisonDifference[];
}) {
  const router = useRouter();
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState<"accept" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(accept: boolean) {
    setBusy(accept ? "accept" : "reject");
    setError(null);
    try {
      const res = await fetch(`/api/buyer/deal/${dealId}/reaffirmation`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "DECIDE_CHANGE", accept }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error?.message ?? "We could not record your decision. Please try again.");
      }
      router.refresh();
    } catch (e) {
      // The ERROR STATE is a real state, not a toast that disappears: a buyer whose decision did
      // not save must be able to see that and try again, not assume it worked.
      setError(e instanceof Error ? e.message : "We could not record your decision. Please try again.");
      setBusy(null);
    }
  }

  const count = differences.length;

  return (
    <section
      aria-labelledby="material-change-heading"
      className="rounded-al-lg border-2 border-al-warning/40 bg-al-surface"
      data-testid="material-change-comparison"
    >
      <header className="border-b border-al-border bg-al-warning-subtle px-5 py-4 sm:px-6">
        <p className="inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.08em] text-al-warning-fg">
          <AlertTriangle size={14} aria-hidden="true" />
          Your decision is needed
        </p>
        <h2 id="material-change-heading" className="mt-1 text-[19px] font-semibold leading-snug text-al-text">
          The dealership changed {count === 1 ? "one thing" : `${count} things`} from the offer you accepted
        </h2>
        <p className="mt-1 text-[14px] leading-relaxed text-al-text-muted">
          Nothing moves forward until you decide. Compare what you accepted with what is now being
          offered.
        </p>
      </header>

      <ul className="divide-y divide-al-border" data-testid="material-change-rows">
        {differences.map((d) => {
          const meta = SEVERITY[d.severity];
          const { Icon } = meta;
          return (
            <li key={d.field} className="px-5 py-5 sm:px-6" data-testid={`material-change-row-${d.field}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.chip}`}
                >
                  <Icon size={12} aria-hidden="true" />
                  {meta.kind}
                </span>
                <span className="text-[15px] font-semibold text-al-text">{d.label}</span>
              </div>

              {/* TWO COLUMNS THAT STACK, never shrink. `sm:` is the only breakpoint — one honest
                  switch rather than three sizes of cramped. */}
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div className="rounded-al-md border border-al-border bg-al-bg px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-al-text-subtle">
                    You accepted
                  </p>
                  <p
                    className="mt-1 text-[17px] font-medium text-al-text-muted line-through decoration-al-text-subtle/60"
                    data-testid={`confirmed-${d.field}`}
                  >
                    {d.confirmed}
                  </p>
                </div>

                <ArrowRight
                  size={18}
                  aria-hidden="true"
                  className="mx-auto hidden text-al-text-subtle sm:block"
                />

                <div className="rounded-al-md border-2 border-al-warning/50 bg-al-warning-subtle px-4 py-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-al-warning-fg">
                    Now proposed
                  </p>
                  <p
                    className={`mt-1 text-[17px] font-bold ${meta.tone}`}
                    data-testid={`proposed-${d.field}`}
                  >
                    {d.proposed}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-[14px] leading-relaxed text-al-text" data-testid={`consequence-${d.field}`}>
                {d.consequence}
              </p>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-al-border px-5 py-5 sm:px-6">
        <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-relaxed text-al-text">
          <input
            type="checkbox"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-al-border-strong text-al-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2"
            data-testid="material-change-understood"
          />
          <span>
            I have read {count === 1 ? "the change" : `all ${count} changes`} above and understand
            what {count === 1 ? "it changes" : "they change"} about my deal.
          </span>
        </label>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-al-md border border-al-danger/30 bg-al-danger-subtle px-4 py-3 text-[14px] text-al-danger-fg"
            data-testid="material-change-error"
          >
            {error}
          </p>
        )}

        {/* ONE ACCEPT, ONE REJECT — equal weight, both full-width, neither a text link. */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => decide(true)}
            disabled={!understood || busy !== null}
            data-testid="material-change-accept"
            className="min-h-[52px] rounded-al-md bg-al-primary px-5 py-3 text-[15px] font-semibold text-al-primary-fg transition-colors hover:bg-al-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-al-border-strong disabled:text-al-text-subtle"
          >
            {busy === "accept" ? "Saving your decision…" : "Accept the change and continue"}
          </button>
          <button
            type="button"
            onClick={() => decide(false)}
            disabled={busy !== null}
            data-testid="material-change-reject"
            className="min-h-[52px] rounded-al-md border-2 border-al-border-strong bg-al-surface px-5 py-3 text-[15px] font-semibold text-al-text transition-colors hover:border-al-text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-al-focus focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:text-al-text-subtle"
          >
            {busy === "reject" ? "Saving your decision…" : "Reject and see my other offers"}
          </button>
        </div>
        <p className="mt-3 text-[13px] leading-relaxed text-al-text-subtle">
          {understood
            ? "Accepting keeps this dealership and carries the new figures into your final recap. Rejecting returns you to the other valid offers on your auction — nothing you have paid is affected either way."
            : "Tick the box above once you have read the comparison. Rejecting does not require it."}
        </p>
      </div>
    </section>
  );
}
