// Feature 3 — Buyer Progress Navigator
// Persistent journey strip injected into buyer layout
// SUPPRESSED on all /buyer/requests/* routes (System 4C exclusion)
//
// Completed steps are clickable and navigate to their respective routes.
// Current step is highlighted but not linked.
// Future/locked steps remain disabled with a lock icon.
//
// Stage routes below are the CANONICAL destinations, not fallbacks:
//   - "financing" → /buyer/deal/financing is where the buyer picks their
//     financing path. (/buyer/financing also exists — it is the credit
//     APPLICATION status page, a different screen, and is currently unlinked.)
//   - "contract"  → /buyer/contracts is the contract list. There is no
//     /buyer/contract.
//   - "sign"      → /buyer/esign is the signing ceremony. There is no /buyer/sign.
//
// This block previously described the first of those as a fallback for a
// "missing" /buyer/financing, which the repository contradicts — that file
// exists. A comment that misstates the routing is worse than none, because the
// next reader "fixes" the route to match it.

"use client";

import { usePathname } from "next/navigation";
import { CheckCircle2, Lock, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import Link from "next/link";

// Route map for each journey stage.
// null = route does not exist; step is rendered as disabled even if completed.
const STAGE_ROUTE: Record<string, string | null> = {
  account: "/buyer/dashboard",
  onboarding: "/buyer/onboarding",
  prequal: "/buyer/prequal",
  search: "/buyer/search",
  shortlist: "/buyer/shortlist",
  deposit: "/buyer/deposit",
  auction: "/buyer/auctions",    // /buyer/auctions (list page; /buyer/auction has no index)
  "select-deal": "/buyer/deal",
  financing: "/buyer/deal/financing", // choose financing path (canonical)
  fee: "/buyer/fee",
  insurance: "/buyer/insurance",
  contract: "/buyer/contracts",       // contract list (canonical; no /buyer/contract)
  sign: "/buyer/esign",               // signing ceremony (canonical; no /buyer/sign)
  pickup: "/buyer/pickup",
  complete: "/buyer/deal",
};

const STAGES = [
  { id: "account", label: "Account" },
  { id: "onboarding", label: "Onboarding" },
  { id: "prequal", label: "Pre-Qual" },
  { id: "search", label: "Search" },
  { id: "shortlist", label: "Shortlist" },
  { id: "deposit", label: "Deposit" },
  { id: "auction", label: "Auction" },
  { id: "select-deal", label: "Select Deal" },
  { id: "financing", label: "Financing" },
  { id: "fee", label: "Fee" },
  { id: "insurance", label: "Insurance" },
  { id: "contract", label: "Contract" },
  { id: "sign", label: "Sign" },
  { id: "pickup", label: "Pickup" },
  // "complete" is a real stage in the shared machine (lib/services/buyer/journey
  // JOURNEY_STAGES). Omitting it here made findIndex return -1 for a buyer whose
  // purchase was COMPLETE, rendering "Step 0 of 14 — Getting Started ·
  // Next: Account" on a finished deal.
  { id: "complete", label: "Complete" },
] as const;

interface JourneyNavigatorProps {
  currentStage?: string;
  completedStages?: string[];
  unlockedStages?: string[];  // admin-unlocked: accessible but not complete
}

export default function JourneyNavigator({
  currentStage = "account",
  completedStages = [],
  unlockedStages = [],
}: JourneyNavigatorProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  // SUPPRESS on all /buyer/requests/* routes (System 4C exclusion)
  if (pathname.startsWith("/buyer/requests")) return null;

  const foundIndex = STAGES.findIndex((s) => s.id === currentStage);
  // Defensive: an unknown stage must not render "Step 0 of N — Getting Started".
  // Fall back to the first stage rather than a nonsense position.
  const currentIndex = foundIndex >= 0 ? foundIndex : 0;
  const stepNum = currentIndex + 1;

  return (
    <div className="bg-white border-b border-slate-200" data-testid="journey-navigator">
      {/* Collapsed summary bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        data-testid="journey-navigator-toggle"
        className="w-full px-6 py-3 flex items-center justify-between hover:bg-slate-50 transition-colors"
        aria-expanded={expanded}
        aria-label="Toggle journey progress"
      >
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-al-primary bg-al-primary/10 px-2.5 py-1 rounded-full">
            Step {stepNum} of {STAGES.length}
          </span>
          <span className="text-sm font-medium text-slate-700">
            {STAGES[currentIndex]?.label ?? "Getting Started"}
          </span>
          {STAGES[currentIndex + 1] && (
            <span className="text-xs text-slate-400 hidden sm:block">
              Next: {STAGES[currentIndex + 1].label}
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronDown size={14} className="text-slate-400" />
        ) : (
          <ChevronRight size={14} className="text-slate-400" />
        )}
      </button>

      {/* Expanded — full stage strip */}
      {expanded && (
        <div
          className="px-6 py-4 border-t border-slate-100 overflow-x-auto"
          data-testid="journey-stage-strip"
        >
          <div className="flex items-center gap-1 min-w-max">
            {STAGES.map((stage, i) => {
              const isCompleted  = completedStages.includes(stage.id);
              const isUnlocked   = unlockedStages.includes(stage.id);
              const isCurrent    = stage.id === currentStage;
              const isLocked     = !isCompleted && !isUnlocked && !isCurrent;
              const route        = STAGE_ROUTE[stage.id] ?? null;
              // Completed AND unlocked stages are both clickable — unlocked still has a route
              const isClickable  = (isCompleted || isUnlocked) && route !== null;

              const pill = (
                <div
                  className={[
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    isCurrent
                      ? "bg-al-primary text-white"
                      : isCompleted
                      ? isClickable
                        ? "bg-green-100 text-green-700 cursor-pointer hover:bg-green-200 hover:text-green-800"
                        : "bg-green-100 text-green-700"
                      : isUnlocked
                      ? "bg-amber-100 text-amber-700 cursor-pointer hover:bg-amber-200"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed",
                  ].join(" ")}
                >
                  {isCompleted ? (
                    <CheckCircle2 size={12} />
                  ) : isUnlocked ? (
                    // No icon for unlocked — accessible but not done
                    null
                  ) : isLocked ? (
                    <Lock size={11} />
                  ) : null}
                  {stage.label}
                </div>
              );

              return (
                <div
                  key={stage.id}
                  className="flex items-center gap-1"
                  data-testid={`stage-${stage.id}`}
                >
                  {isClickable ? (
                    <Link
                      href={route}
                      aria-label={`Go to ${stage.label}`}
                      title={`Return to ${stage.label}`}
                    >
                      {pill}
                    </Link>
                  ) : (
                    <span
                      aria-disabled={isLocked}
                      aria-label={isLocked ? `${stage.label} — locked` : stage.label}
                    >
                      {pill}
                    </span>
                  )}
                  {i < STAGES.length - 1 && (
                    <div
                      className={`w-4 h-px ${isCompleted ? "bg-green-300" : "bg-slate-200"}`}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
