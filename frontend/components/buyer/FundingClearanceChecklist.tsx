import { CheckCircle2, CircleDashed, MinusCircle } from "lucide-react";
import type { ClearanceItem } from "@/lib/services/deal/funding-clearance.service";

/**
 * §Stage 14's six-item funding-clearance list, as the buyer sees it.
 *
 * WHY THIS IS A SCREEN AND NOT A STATUS. Stage 14's buyer-visible copy is "Financing
 * complete — preparing your vehicle for delivery, OR THE SPECIFIC OUTSTANDING CONDITION AND
 * WHO OWNS IT". A single "funding pending" badge cannot say either half. A buyer whose deal
 * is held on a lender stipulation and a buyer whose deal is held on their own paperwork are
 * in completely different situations, and telling both of them "pending" is how a deal sits
 * for a week with nobody knowing whose move it is.
 *
 * OWNERSHIP IS THE POINT. Every row names who has to act. The buyer should be able to look
 * at this and know, in one read, whether anything is theirs — and for most of these it never
 * is, which is itself worth showing rather than leaving them to wonder.
 *
 * "Not needed for your deal" is a THIRD state, deliberately. A trade payoff on a deal with
 * no trade is not satisfied and not outstanding: it does not apply. Rendering it as a green
 * tick would claim a check that never ran, and rendering it as outstanding would hold a
 * buyer on a condition that cannot exist.
 */
export default function FundingClearanceChecklist({
  items,
  clear,
}: {
  items: ClearanceItem[];
  clear: boolean;
}) {
  const OWNER_LABEL: Record<string, string> = {
    FINANCE: "AutoLenis Finance",
    DEALERSHIP: "The dealership",
    BUYER: "You",
    OPERATIONS: "AutoLenis Operations",
  };

  return (
    <section
      className="bg-white border border-slate-200 rounded-xl p-5 md:p-6"
      aria-labelledby="clearance-heading"
      data-testid="funding-clearance-checklist"
    >
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <h2 id="clearance-heading" className="font-semibold text-slate-900">
          Before your vehicle is released
        </h2>
        {clear && (
          <span
            className="text-xs font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-1"
            data-testid="funding-clearance-cleared"
          >
            All clear
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500 mb-4">
        We never release a vehicle on the expectation that financing will complete later. Each of
        these is confirmed against evidence first — it is what protects you from a deal unwinding
        after you have driven away.
      </p>

      <ul className="space-y-3">
        {items.map((item) => {
          const notApplicable = item.notApplicable === true;
          return (
            <li key={item.key} className="flex items-start gap-3" data-testid={`clearance-item-${item.key}`}>
              {notApplicable ? (
                <MinusCircle size={17} className="text-slate-300 mt-0.5 flex-shrink-0" aria-hidden="true" />
              ) : item.satisfied ? (
                <CheckCircle2 size={17} className="text-green-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
              ) : (
                <CircleDashed size={17} className="text-amber-500 mt-0.5 flex-shrink-0" aria-hidden="true" />
              )}
              {/* The state in WORDS, for a reader that never sees the icon. The icons are
                  aria-hidden because they are decorative beside a text label — but that left
                  "satisfied" carrying NO textual signal at all: outstanding rows say "Waiting on",
                  not-applicable rows say "Not needed", and a satisfied row said nothing, so a
                  screen-reader user could only infer it from the absence of the other two. Shape
                  varies as well as colour, so this is not WCAG 1.4.1 — it is the plainer problem
                  of a state that is visible and unreadable. */}
              <span className="sr-only">
                {notApplicable ? "Not applicable:" : item.satisfied ? "Complete:" : "Outstanding:"}
              </span>
              <div className="min-w-0">
                <p
                  className={`text-sm ${item.satisfied && !notApplicable ? "text-slate-500" : "font-medium text-slate-800"}`}
                >
                  {item.label}
                </p>
                <p className="text-xs text-slate-500 mt-0.5 break-words">{item.detail}</p>
                {/* The owner is shown only where it MATTERS — on an outstanding item. A
                    satisfied row naming an owner is noise, and noise is what stops people
                    reading the rows that need them. */}
                {!item.satisfied && !notApplicable && (
                  <p className="text-xs mt-1">
                    {/* slate-500, not slate-400: 4.76:1 against white where slate-400 is 2.56:1.
                        "Waiting on:" is the label for the one fact on this row a buyer may have
                        to act on, so it is body text and owes WCAG AA, not decoration. */}
                    <span className="text-slate-500">Waiting on: </span>
                    <span
                      className={`font-semibold ${item.owner === "BUYER" ? "text-amber-700" : "text-slate-600"}`}
                    >
                      {OWNER_LABEL[item.owner] ?? item.owner}
                    </span>
                  </p>
                )}
                {/* Same correction: this sentence IS the third state — the only thing telling a
                    buyer the row was checked and does not apply. At 2.56:1 it was the least
                    readable text on the row while carrying its whole meaning. */}
                {notApplicable && <p className="text-xs text-slate-500 mt-0.5">Not needed for your deal.</p>}
              </div>
            </li>
          );
        })}
      </ul>

      {!clear && !items.some((i) => !i.satisfied && i.owner === "BUYER") && (
        <p className="text-xs text-slate-500 mt-4 pt-4 border-t border-slate-100">
          Nothing here is waiting on you. We will tell you the moment it clears.
        </p>
      )}
    </section>
  );
}
