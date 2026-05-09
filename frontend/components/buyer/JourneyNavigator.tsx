// Feature 3 — Buyer Progress Navigator
// Persistent journey strip injected into buyer layout
// SUPPRESSED on all /buyer/requests/* routes (System 4C exclusion)
//
// Completed steps are clickable and navigate to their respective routes.
// Current step is highlighted but not linked.
// Future/locked steps remain disabled with a lock icon.
//
// Missing routes (no dedicated page yet):
//   - "financing" → /buyer/financing (use /buyer/deal/financing as fallback)
//   - "contract"  → /buyer/contract (use /buyer/contracts as fallback)
//   - "sign"      → /buyer/sign (use /buyer/esign as fallback)

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
  financing: "/buyer/deal/financing", // canonical /buyer/financing missing — fallback
  fee: "/buyer/fee",
  insurance: "/buyer/insurance",
  contract: "/buyer/contracts",       // canonical /buyer/contract missing — fallback
  sign: "/buyer/esign",               // canonical /buyer/sign missing — fallback
  pickup: "/buyer/pickup",
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
] as const;

interface JourneyNavigatorProps {
  currentStage?: string;
  completedStages?: string[];
}

export default function JourneyNavigator({
  currentStage = "account",
  completedStages = [],
}: JourneyNavigatorProps) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);

  // SUPPRESS on all /buyer/requests/* routes (System 4C exclusion)
  if (pathname.startsWith("/buyer/requests")) return null;

  const currentIndex = STAGES.findIndex((s) => s.id === currentStage);
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
          <span className="text-xs font-semibold text-[#0B5FD1] bg-[#0B5FD1]/10 px-2.5 py-1 rounded-full">
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
              const isCompleted = completedStages.includes(stage.id);
              const isCurrent = stage.id === currentStage;
              const isLocked = !isCompleted && !isCurrent;
              const route = STAGE_ROUTE[stage.id] ?? null;
              // A completed step is only clickable when a valid route exists.
              const isClickable = isCompleted && route !== null;

              const pill = (
                <div
                  className={[
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors",
                    isCurrent
                      ? "bg-[#0B5FD1] text-white"
                      : isCompleted
                      ? isClickable
                        ? "bg-green-100 text-green-700 cursor-pointer hover:bg-green-200 hover:text-green-800"
                        : "bg-green-100 text-green-700"
                      : "bg-slate-100 text-slate-400 cursor-not-allowed",
                  ].join(" ")}
                >
                  {isCompleted ? (
                    <CheckCircle2 size={12} />
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
