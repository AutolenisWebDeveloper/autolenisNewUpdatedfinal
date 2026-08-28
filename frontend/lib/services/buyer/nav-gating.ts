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

/**
 * The only hrefs app/buyer/layout.tsx permits before onboarding is complete —
 * everything else is redirected to /buyer/onboarding. Mirrored here so the nav
 * can show those items as LOCKED with a reason instead of rendering links that
 * silently bounce. Keep in step with the layout's allowedWithoutOnboarding set.
 */
export const ONBOARDING_ALLOWED_HREFS: ReadonlySet<string> = new Set([
  "/buyer/dashboard",
  "/buyer/onboarding",
  "/buyer/profile",
  "/buyer/settings",
  "/buyer/suspended",
]);

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
  // Onboarding gate first: until onboarding is complete the layout redirects
  // every other /buyer/* route to /buyer/onboarding, so NOTHING outside the
  // allowed set is actually reachable — not even the "ungated" account items.
  // Treating them as reachable is what produced 20 sidebar links that silently
  // bounced a new buyer with no explanation.
  if (!journey.completedStages.includes("onboarding")) {
    return ONBOARDING_ALLOWED_HREFS.has(href);
  }

  const required = NAV_STAGE_REQUIREMENT[href];
  if (!required) return true; // ungated item

  if (journey.completedStages.includes(required)) return true;
  if (journey.currentStage === required) return true;
  if (journey.unlockedStages.includes(required)) return true;
  // Reached-or-past: the current stage sits at or beyond the required stage.
  return stageIndex(journey.currentStage) >= stageIndex(required);
}
