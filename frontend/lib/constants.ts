// AutoLenis V4 — lib/constants.ts
// SINGLE SOURCE OF TRUTH for all platform constants.
// D2: Commission rates — all references must import from here. No inline rate definitions.

// ─── Payment Constants ────────────────────────────────────────────────────────
export const DEPOSIT_AMOUNT_CENTS = 9900;              // $99 — Auction Access Deposit (both plans)
export const PREMIUM_FEE_CENTS = 49900;                // $499 — Premium concierge fee total
export const PREMIUM_FEE_REMAINING_CENTS = 40000;      // $400 — Premium fee after $99 deposit credit
export const STANDARD_FEE_CENTS = 0;                   // Standard buyers pay no concierge fee

export type BuyerPlanKey = "STANDARD" | "PREMIUM";

export const BUYER_PLANS = {
  STANDARD: {
    key: "STANDARD" as const,
    label: "Standard",
    priceLabel: "Free to start",
    conciergeFeeCents: STANDARD_FEE_CENTS,
    depositCreditsTo: "purchase",
  },
  PREMIUM: {
    key: "PREMIUM" as const,
    label: "Premium",
    priceLabel: "$499 concierge fee",
    conciergeFeeCents: PREMIUM_FEE_CENTS,
    depositCreditsTo: "conciergeFee",
  },
} as const;

// ─── Auction Constants ────────────────────────────────────────────────────────
export const AUCTION_DURATION_HOURS = 48;
export const MAX_SHORTLIST_ITEMS = 5;
export const MAX_DEALER_INVITATIONS = 8;
export const AUCTION_EXTENSION_HOURS = 24;

// ─── Commission Rates (3-level ONLY — D2) ─────────────────────────────────────
// L4 and L5 do not exist. Commission walk depth: maximum 3 levels.
// Rate is persisted on each Commission row at creation time, so changes here
// only affect future commissions — historical PAID records remain immutable.
export const COMMISSION_RATES = {
  LEVEL_1: 0.15, // 15% — paid to the direct referrer
  LEVEL_2: 0.03, // 3%  — paid to the L1 affiliate's referrer
  LEVEL_3: 0.03, // 3%  — paid to the L2 affiliate's referrer
} as const;

// Total max commission payout across all levels: 21%
export const MAX_COMMISSION_TOTAL =
  COMMISSION_RATES.LEVEL_1 + COMMISSION_RATES.LEVEL_2 + COMMISSION_RATES.LEVEL_3;

// ─── Contract Shield Thresholds ───────────────────────────────────────────────
export const CONTRACT_SHIELD_PASS_THRESHOLD = 85;
export const CONTRACT_SHIELD_WARNING_MIN = 70;
export const CONTRACT_SHIELD_WARNING_MAX = 84;
export const CONTRACT_SHIELD_FAIL_MAX = 69;

export type ContractShieldResult = "PASS" | "WARNING" | "FAIL";

export function getContractShieldResult(score: number): ContractShieldResult {
  if (score >= CONTRACT_SHIELD_PASS_THRESHOLD) return "PASS";
  if (score >= CONTRACT_SHIELD_WARNING_MIN) return "WARNING";
  return "FAIL";
}

// ─── JWT Configuration ────────────────────────────────────────────────────────
export const JWT_TTL_STANDARD_DAYS = 7;
export const JWT_TTL_REMEMBER_ME_DAYS = 30;
export const JWT_TTL_STANDARD_SECONDS = JWT_TTL_STANDARD_DAYS * 24 * 60 * 60;
export const JWT_TTL_REMEMBER_ME_SECONDS = JWT_TTL_REMEMBER_ME_DAYS * 24 * 60 * 60;

// ─── iPredict Score Tiers ─────────────────────────────────────────────────────
export const IPREDICT_TIERS = {
  STRONG: { min: 700, max: 850, label: "Strong" },
  GOOD: { min: 620, max: 699, label: "Good" },
  FAIR: { min: 550, max: 619, label: "Fair" },
  WEAK: { min: 480, max: 549, label: "Weak" },
  DECLINED: { min: 300, max: 479, label: "Declined" },
} as const;

// ─── Auction Gating Rule ─────────────────────────────────────────────────────
// D1: NEVER check PreQualification.status — the field does not exist.
// The correct gating pattern is:
//   prequal record EXISTS && prequal.expiresAt > now()
// This is the only valid auction gate.

// ─── iPredict OFAC Rule ──────────────────────────────────────────────────────
// checkOfacAlert = true MUST auto-escalate to manual review immediately.
// NEVER auto-approve an OFAC-flagged application regardless of iPredict score.

// ─── maxOtdAmountCents Rule ──────────────────────────────────────────────────
// This value from iPredict is immutable.
// No UI control, calculator, or component can modify or exceed it.
// It is a read-only output of the iPredict decision engine.

// ─── Inventory Lane Labels ────────────────────────────────────────────────────
export const INVENTORY_LANES = {
  LANE_1: { label: "Verified", chipColor: "green" },  // Dealer inventory
  LANE_2: { label: "Partner-Adjacent", chipColor: "blue" },
  LANE_3: { label: "Open Market", chipColor: "gray" },
} as const;

// ─── System 4C Rate Limiting ─────────────────────────────────────────────────
export const VEHICLE_REQUEST_MAX_PER_HOUR = 3;    // 4th submission rejected
export const VEHICLE_REQUEST_MAX_ACTIVE_OFFERS = 3; // 4th offer attempt rejected

// ─── Nudge Engine Defaults ────────────────────────────────────────────────────
export const NUDGE_DEFAULTS = {
  PREQUAL_IDLE_HOURS: 4,
  DEPOSIT_IDLE_HOURS: 12,
  FINANCING_IDLE_HOURS: 6,
  INSURANCE_IDLE_HOURS: 24,
  EMAIL_NUDGE_IDLE_HOURS: 48,
  MAX_DISMISSALS_BEFORE_STOP: 3,
  COOLDOWN_HOURS_AFTER_DISMISS: 48,
} as const;

// ─── Deal Risk Tiers ─────────────────────────────────────────────────────────
export const DEAL_RISK_TIERS = {
  LOW: { min: 0, max: 30, label: "Low Risk" },
  MEDIUM: { min: 31, max: 60, label: "Medium Risk" },
  HIGH: { min: 61, max: 80, label: "High Risk" },
  CRITICAL: { min: 81, max: 100, label: "Critical" },
} as const;

// ─── Saved Search Limits ─────────────────────────────────────────────────────
export const MAX_SAVED_SEARCHES = 3;

// ─── Offer Revision ──────────────────────────────────────────────────────────
export const MAX_OFFER_REVISIONS = 1;  // Dealers may revise their offer once

// ─── Refinance (System 14) ───────────────────────────────────────────────────
export const REFINANCE_MIN_VEHICLE_YEAR = new Date().getFullYear() - 10;
export const REFINANCE_MIN_CREDIT_SCORE = 580;

// ─── Faith Layer (System 25) ─────────────────────────────────────────────────
// Verse rotation: no repeat within 52 weeks per page
export const FAITH_VERSE_ROTATION_WEEKS = 52;
export const FAITH_VERSE_ENABLED_PAGES = [
  "homepage",
  "how-it-works",
  "pricing",
  "refinance",
  "about",
  "contract-shield",
  "partner-program",
  "for-dealers",
] as const;

// Contact and Sign In pages MUST have no verse or faith modules
export const FAITH_VERSE_EXCLUDED_PAGES = ["contact", "signin"] as const;

// ─── Admin TOTP ───────────────────────────────────────────────────────────────
// Admin MFA uses RFC 6238-compliant TOTP via the `otpauth` npm library.
// Custom TOTP implementations are prohibited (D6).

// ─── Inventory Health ────────────────────────────────────────────────────────
export const INVENTORY_HEALTH_P1_THRESHOLD = 70; // configurable from admin settings

// ─── Cron Secret Header ──────────────────────────────────────────────────────
export const CRON_AUTH_HEADER = "Authorization";
export const CRON_AUTH_PREFIX = "Bearer ";

// ─── API Response Shape ──────────────────────────────────────────────────────
// All API responses must use:
//   Success: { success: true, data: T }
//   Error:   { error: { code: string, message: string }, correlationId: string }

// ─── Affiliate Document Upload ───────────────────────────────────────────────
export const AFFILIATE_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Affiliate Compliance ─────────────────────────────────────────────────────
export const AFFILIATE_DISCLOSURE_VERSION = "1.0";
