// lib/services/buyer/journey.ts — the single source of truth for the buyer
// journey stage machine (M-3).
//
// Previously the stage was computed independently in app/buyer/layout.tsx (a
// deal.status → stage switch) and in app/api/buyer/journey-status (a
// fact-derived progression). They had drifted — different completed-stage sets
// and a "complete" stage the layout lacked — so the sidebar and the API could
// disagree. This module is the ONE fact-derived machine both consume, matching
// the platform's "state-derived, not manually advanced" journey design.
//
// Pure function over a plain facts object (no Prisma/IO) so it is trivially
// unit-testable; callers gather the facts and pass them in.

export const JOURNEY_STAGES = [
  "account", "onboarding", "prequal", "search", "shortlist",
  "deposit", "auction", "select-deal", "financing", "fee",
  "insurance", "contract", "sign", "pickup", "complete",
] as const;

export type JourneyStage = (typeof JOURNEY_STAGES)[number];

export interface JourneyDealFacts {
  status: string;
  /** true once the buyer has chosen a financing path (deal.financingPath set). */
  hasFinancingPath: boolean;
  /** true once the concierge fee is paid (deal.feePaidAt set). */
  feePaid: boolean;
  /** deal.insuranceStatus; "NOT_STARTED" means insurance not yet begun. */
  insuranceStatus: string;
  /** true once Contract Shield has passed (deal.contractShieldStatus === "PASS"). */
  contractShieldPassed: boolean;
}

export interface JourneyFacts {
  onboardingComplete: boolean;
  prequalValid: boolean;
  shortlistCount: number;
  depositPaid: boolean;
  activeAuction: boolean;
  deal: JourneyDealFacts | null;
  /** Admin journey overrides. SKIP = counts complete; UNLOCK = accessible only. */
  overrides?: Array<{ stageId: string; type: "SKIP" | "UNLOCK" }>;
}

export interface JourneyResult {
  currentStage: JourneyStage;
  completedStages: JourneyStage[];
  unlockedStages: string[];
  nextAction: string;
}

const NEXT_ACTION: Record<JourneyStage, string> = {
  account: "Create your account",
  onboarding: "Complete your profile",
  prequal: "Check your buying power",
  search: "Browse inventory",
  shortlist: "Add vehicles to shortlist",
  deposit: "Activate your auction ($99)",
  auction: "Monitor your live auction",
  "select-deal": "Review your offers",
  financing: "Choose your financing path",
  fee: "Pay the concierge fee",
  insurance: "Arrange insurance coverage",
  contract: "Review your contract",
  sign: "Sign your documents",
  pickup: "Pick up your vehicle",
  complete: "Your deal is complete",
};

export function getNextAction(stage: JourneyStage): string {
  return NEXT_ACTION[stage] ?? "Continue your journey";
}

// Deal facts → journey stage, evaluated in ascending order so the furthest
// reached stage wins. Kept as a small ordered table rather than a switch so the
// completed-set and the current stage are derived from one description.
function dealStage(deal: JourneyDealFacts): { current: JourneyStage; completedThrough: JourneyStage } {
  const s = deal.status;
  if (s === "COMPLETED") return { current: "complete", completedThrough: "pickup" };
  if (s === "PICKUP_SCHEDULED" || s === "PICKUP_COMPLETE") return { current: "pickup", completedThrough: "sign" };
  if (s === "SIGNING_PENDING" || s === "SIGNED") return { current: "sign", completedThrough: "contract" };
  if (deal.contractShieldPassed) return { current: "sign", completedThrough: "contract" };
  if (s === "CONTRACT_PENDING" || s === "CONTRACT_REVIEW" || s === "CONTRACT_APPROVED")
    return { current: "contract", completedThrough: "insurance" };
  if (deal.insuranceStatus !== "NOT_STARTED") return { current: "contract", completedThrough: "insurance" };
  if (s === "INSURANCE_PENDING") return { current: "insurance", completedThrough: "fee" };
  if (deal.feePaid) return { current: "insurance", completedThrough: "fee" };
  if (s === "FEE_PENDING" || s === "FEE_PAID") return { current: "fee", completedThrough: "financing" };
  if (deal.hasFinancingPath) return { current: "fee", completedThrough: "financing" };
  if (s === "FINANCING_PENDING") return { current: "financing", completedThrough: "select-deal" };
  return { current: "financing", completedThrough: "select-deal" };
}

export function computeJourney(facts: JourneyFacts): JourneyResult {
  const completed = new Set<JourneyStage>(["account"]);
  let currentStage: JourneyStage = "onboarding";

  if (facts.onboardingComplete) {
    completed.add("onboarding");
    currentStage = "prequal";
  }
  if (facts.onboardingComplete && facts.prequalValid) {
    completed.add("prequal");
    currentStage = "search";
  }
  const prereqForSearch = facts.onboardingComplete && facts.prequalValid;
  if (prereqForSearch && facts.shortlistCount > 0) {
    completed.add("search").add("shortlist");
    currentStage = "deposit";
  }
  if (currentStage === "deposit" && facts.depositPaid) {
    completed.add("deposit");
    currentStage = "auction";
  }
  if (currentStage === "auction" && facts.activeAuction) {
    currentStage = "auction";
  }

  // Deal facts take over once a deal exists (a deal implies deposit+auction+select).
  if (facts.deal) {
    completed.add("deposit").add("auction").add("select-deal");
    const idxOf = (st: JourneyStage) => JOURNEY_STAGES.indexOf(st);
    const { current, completedThrough } = dealStage(facts.deal);
    for (const st of JOURNEY_STAGES) {
      if (idxOf(st) <= idxOf(completedThrough)) completed.add(st);
    }
    currentStage = current;
  }

  // Admin overrides: SKIP counts as complete for progression; UNLOCK only marks
  // a stage accessible without completing it.
  const unlockedStages: string[] = [];
  for (const o of facts.overrides ?? []) {
    if (o.type === "SKIP") {
      if ((JOURNEY_STAGES as readonly string[]).includes(o.stageId)) completed.add(o.stageId as JourneyStage);
    } else if (o.type === "UNLOCK") {
      unlockedStages.push(o.stageId);
    }
  }

  // Emit completedStages in canonical journey order.
  const completedStages = JOURNEY_STAGES.filter((st) => completed.has(st));
  return { currentStage, completedStages, unlockedStages, nextAction: getNextAction(currentStage) };
}
