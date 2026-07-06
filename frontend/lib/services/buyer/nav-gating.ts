// lib/services/buyer/nav-gating.ts — journey-aware buyer nav gating (M-4).
//
// The buyer sidebar previously showed all deal-flow links regardless of stage,
// so a brand-new buyer saw Financing / Contract Shield / Sign Documents /
// Pickup links that lead to "nothing yet" pages. This pure helper decides,
// from the shared M-3 journey machine's output, whether a deal-flow nav item is
// REACHABLE yet — the sidebar renders unreachable items in a locked (disabled)
// affordance rather than a dead link.
//
// Only DEAL-FLOW items are gated. Account/utility items (dashboard, profile,
// settings, notifications, messages, documents, activity, referral, requests,
// trade-in, saved searches, billing) and the early funnel (prequal, search,
// shortlist) are always accessible.

import { JOURNEY_STAGES, type JourneyStage } from "./journey";

// nav href → the journey stage that unlocks it. Items absent from this map are
// always accessible.
export const NAV_STAGE_REQUIREMENT: Record<string, JourneyStage> = {
  "/buyer/auctions": "auction",
  "/buyer/deal": "select-deal",
  "/buyer/deal/financing": "financing",
  "/buyer/fee": "fee",
  "/buyer/insurance": "insurance",
  "/buyer/contract-shield": "contract",
  "/buyer/contracts": "contract",
  "/buyer/esign": "sign",
  "/buyer/pickup": "pickup",
};

export interface JourneyView {
  currentStage: JourneyStage;
  completedStages: JourneyStage[];
  unlockedStages: string[];
}

const stageIndex = (s: JourneyStage) => JOURNEY_STAGES.indexOf(s);

/**
 * A deal-flow nav item is reachable when its required stage is the current
 * stage, already completed, at/behind the current stage's position, or
 * explicitly unlocked by an admin override. Non-gated hrefs are always
 * reachable.
 */
export function isNavItemReachable(href: string, journey: JourneyView): boolean {
  const required = NAV_STAGE_REQUIREMENT[href];
  if (!required) return true; // ungated item

  if (journey.completedStages.includes(required)) return true;
  if (journey.currentStage === required) return true;
  if (journey.unlockedStages.includes(required)) return true;
  // Reached-or-past: the current stage sits at or beyond the required stage.
  return stageIndex(journey.currentStage) >= stageIndex(required);
}
