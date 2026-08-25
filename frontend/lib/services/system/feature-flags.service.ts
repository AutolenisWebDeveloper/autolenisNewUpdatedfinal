// lib/services/system/feature-flags.service.ts
import { getFeatureFlag, setFeatureFlag } from "@/lib/services/admin/admin-platform.service";

export const FLAGS = {
  AI_CONCIERGE: "ai_concierge",
  REFINANCE_ENABLED: "refinance_enabled",
  TRADE_IN_ENABLED: "trade_in_enabled",
  INSURANCE_MOCK: "insurance_mock",
  SYSTEM_4C_ENABLED: "system_4c_enabled",
  // Batch 2 — when ON, only dealers with a signed agreement + admin-verified
  // license are invited to compete in auctions. DEFAULT OFF (no FeatureFlag row →
  // getFeatureFlag returns false); existing ACTIVE dealers keep portal access.
  DEALER_VERIFICATION_GATE: "dealer_verification_gate",

  // Program 2 — per-workload lifecycle producer authority. When a flag is ON the
  // corresponding root producer enqueues to the internal durable
  // `lifecycle_touch_schedule` substrate (drained by cron/lifecycle-touch-drain);
  // when OFF the existing QStash producer stays authoritative. The two branches
  // are mutually exclusive per call, so exactly ONE authority owns a workload at
  // any time (never both). ALL DEFAULT OFF (no FeatureFlag row → false) — the
  // owner-gated atomic cutover flips a workload's flag ON, which simultaneously
  // enables the internal producer and disables the QStash dispatch for that
  // workload. See docs/automation-program-2-lifecycle-orchestration.md.
  LIFECYCLE_INTERNAL_DEPOSIT_REMINDER: "lifecycle_internal_deposit_reminder",
  LIFECYCLE_INTERNAL_AUCTION: "lifecycle_internal_auction",
  LIFECYCLE_INTERNAL_DEALER_INVITED: "lifecycle_internal_dealer_invited",
  LIFECYCLE_INTERNAL_OFFER: "lifecycle_internal_offer",
  LIFECYCLE_INTERNAL_DEAL_COMPLETE: "lifecycle_internal_deal_complete",
  LIFECYCLE_INTERNAL_FORM_SUBMITTED: "lifecycle_internal_form_submitted",
} as const;

export async function isEnabled(flag: string): Promise<boolean> {
  return getFeatureFlag(flag);
}

export async function enable(flag: string, adminId: string) {
  return setFeatureFlag(flag, true, adminId);
}

export async function disable(flag: string, adminId: string) {
  return setFeatureFlag(flag, false, adminId);
}
