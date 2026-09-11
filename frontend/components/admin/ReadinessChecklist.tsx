// §Stage 7 — "Any failure keeps the auction pending and shows the exact missing prerequisite."
//
// THE WORD "EXACT" IS THE REQUIREMENT. A checklist of eight green and red ticks satisfies the
// letter and not the point: an operator looking at a red DEALER_COUNT needs to know it is "3
// invitation-ready rooftops; the minimum field is 3 with approval, 5 without", because that
// sentence names the action. So the blocker string is rendered, not summarised, and it comes
// from `evaluateReadiness` — the same string the launch records on the queue item, so the
// screen and the exception say the same thing.
//
// EVERY FAILURE NAMES ITS OWNER, which §26 requires of every exception and which decides who
// picks the item up. A BUYER blocker is not Operations' to fix, and showing them
// undifferentiated is how an operator spends an afternoon on a prequalification only the buyer
// can renew.
//
// A SERVER COMPONENT. It renders what it is given and owns no state.

import { AlertCircle, CheckCircle2, Circle } from "lucide-react";
import { CARD, EYEBROW } from "@/components/ui/patterns";
import { cn } from "@/lib/utils";
import type { ReadinessItem } from "@/lib/services/sourcing/launch-readiness.service";

const OWNER_STYLES: Record<ReadinessItem["owner"], string> = {
  SYSTEM: "bg-slate-100 text-slate-600",
  BUYER: "bg-[#EFF6FF] text-[#0B5FD1]",
  OPERATIONS: "bg-amber-50 text-amber-700",
  COMPLIANCE: "bg-indigo-50 text-indigo-700",
};

export default function ReadinessChecklist({
  items,
  ready,
  fieldSize,
}: {
  items: ReadinessItem[];
  ready: boolean;
  /** How many rooftops would actually be invited — the field the launch would use. */
  fieldSize: number;
}) {
  const failed = items.filter((i) => !i.passed);

  return (
    <section
      className={cn(CARD, "mt-5 p-5")}
      data-testid="readiness-checklist"
      data-ready={ready ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={EYEBROW}>Launch readiness</p>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-semibold",
            ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
          )}
          data-testid="readiness-verdict"
        >
          {ready ? "Ready to launch" : `${failed.length} blocker${failed.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <p className="mt-2 text-sm text-slate-600">
        {ready
          ? `All eight entry items pass. The launch would invite ${fieldSize} rooftop${fieldSize === 1 ? "" : "s"}.`
          : "The auction stays PENDING until every item passes. Each blocker below names what is missing and who can clear it."}
      </p>

      <ul className="mt-4 divide-y divide-slate-100" data-testid="readiness-items">
        {items.map((item) => (
          <li
            key={item.key}
            className="flex items-start gap-3 py-3"
            data-testid={`readiness-item-${item.key}`}
            data-passed={item.passed ? "true" : "false"}
          >
            <span className="mt-0.5 shrink-0" aria-hidden="true">
              {item.passed ? (
                <CheckCircle2 size={16} className="text-emerald-600" />
              ) : (
                <AlertCircle size={16} className="text-amber-600" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={cn(
                    "text-sm",
                    item.passed ? "text-slate-600" : "font-semibold text-slate-900",
                  )}
                >
                  {item.label}
                </p>
                {!item.passed && (
                  <span
                    className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide", OWNER_STYLES[item.owner])}
                    data-testid={`readiness-owner-${item.key}`}
                  >
                    {item.owner}
                  </span>
                )}
              </div>
              {/* The exact blocker, verbatim. Summarising it here is how a screen stops being
                  actionable — and it is the same string the queue item carries. */}
              {item.blocker && (
                <p className="mt-0.5 text-sm text-slate-600" data-testid={`readiness-blocker-${item.key}`}>
                  {item.blocker}
                </p>
              )}
            </div>
            {/* The status announced in text as well as in colour and icon. */}
            <span className="sr-only">{item.passed ? "passes" : "blocked"}</span>
          </li>
        ))}
      </ul>

      {items.length === 0 && (
        <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
          <Circle size={12} aria-hidden="true" /> No readiness items were returned — this is a
          failure to evaluate, not a passing case.
        </p>
      )}
    </section>
  );
}
