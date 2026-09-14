// lib/services/plan/upgrade-touchpoints.ts
//
// §23.2a's five touchpoints, as DATA — a module with no imports at all.
//
// WHY IT IS ITS OWN FILE. The vocabulary used to live in `upgrade-suppression.service.ts`, which
// imports `entitledPlanForRequest` from `plan-snapshot.service.ts`, which imports the vocabulary
// back. That cycle was harmless while nothing else joined it, and stopped being harmless the
// moment `upgrade-touchpoint.service.ts` entered the graph from a third point: the constants were
// still in their temporal dead zone when the cycle resolved, and every call failed at run time
// with "Cannot access 'UPGRADE_TOUCHPOINTS' before initialization" — a failure `tsc` cannot see,
// because the types are perfectly consistent.
//
// A leaf module with no imports cannot participate in a cycle, so the vocabulary is now safe to
// import from anywhere. `upgrade-suppression.service.ts` re-exports it, so every existing importer
// is untouched.

/** §23.2a's five touchpoints. The vocabulary PAY-77 measures against. */
export const UPGRADE_TOUCHPOINTS = {
  /** Payment confirmation — a single line on the receipt and the sourcing-started screen. */
  RECEIPT: "receipt",
  /** Alongside the Best Price Report. */
  BEST_PRICE_REPORT: "best_price_report",
  /** The full-screen invitation, once, immediately after offer acceptance. */
  POST_ACCEPTANCE: "post_acceptance",
  /** Email one hour after acceptance, only if the invitation was declined or dismissed. */
  POST_ACCEPTANCE_EMAIL: "post_acceptance_email",
  /** Email at dealer reaffirmation or recap. The second and final ask. */
  REAFFIRMATION_EMAIL: "reaffirmation_email",
} as const;

export type UpgradeTouchpoint = (typeof UPGRADE_TOUCHPOINTS)[keyof typeof UPGRADE_TOUCHPOINTS];

/** The two touchpoints that are EMAILS. §23.2b: two emails, then silence. */
export const EMAIL_TOUCHPOINTS: readonly UpgradeTouchpoint[] = [
  UPGRADE_TOUCHPOINTS.POST_ACCEPTANCE_EMAIL,
  UPGRADE_TOUCHPOINTS.REAFFIRMATION_EMAIL,
];
