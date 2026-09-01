// AMIPS Phase 2 — five-gate quality validator.
//
// Every AMIPS page passes through these five gates before it can publish. They
// replace the Phase C2 six-point rubric for AMIPS content (the C2 rubric is
// untouched and still governs /buying-guide pages). The validator is pure and
// synchronous: the orchestrator pre-fetches the small set of same-vehicle/metro
// bodies needed for the uniqueness gate and passes them in, so this stays
// deterministic and unit-testable.
//
//   5/5 passed → PUBLISHED
//   4/5 passed → REVIEW_NEEDED
//   <4 passed  → FAILED (return to queue)

import type { GeneratedAmipsArticle } from "@/lib/amips/prompts/amips-generator.prompts";
import type { AmipsPageData } from "@/lib/amips/assembler";
import { FRESHNESS_DAYS } from "@/lib/amips/assembler";
import { MARKET_DATA_TIERS } from "@/lib/amips/tiers";

// Freshness (Gate 5) uses the SAME authoritative set as the lifecycle staleness
// check. Previously this was {C,D,E} while the lifecycle used {C,D,E,F}, so a
// Tier F page was certified fresh here and simultaneously treated as
// permanently stale there. See lib/amips/tiers.ts.
const METRO_TIERS = MARKET_DATA_TIERS;

export interface QualityGateResult {
  passed: boolean; // true only when all five gates pass
  score: number; // 0-5
  failedGates: string[];
  warnings: string[];
  status: "PUBLISHED" | "REVIEW_NEEDED" | "FAILED";
  cleanedBody: string; // body after compliance stripping
}

// ── Gate 3 banned patterns ─────────────────────────────────────────────────
// Stripped (soft): unverifiable savings claims. We have no transaction data at
// Tier B–E, so any "$X saved" / "average savings" language is removed.
const STRIP_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsaved?\s+\$[\d,]+/gi, label: "savings amount" },
  { re: /\baverage savings\b/gi, label: "average savings claim" },
];
// Hard fail: absolute guarantees are never compliant.
const HARD_FAIL_PATTERN = /\bguaranteed\b/gi;
// Undated APR claims get a warning flag (incentives must carry an expiration).
const UNDATED_APR_PATTERN = /\b\d+(?:\.\d+)?\s*%\s*APR\b/gi;

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

// Jaccard word-overlap similarity (0-1). Cheap, deterministic, good enough to
// catch near-duplicate bodies for the same vehicle + metro.
function similarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

function isFresh(asOf: Date | undefined, withinDays: number): boolean {
  if (!asOf) return false;
  return Date.now() - asOf.getTime() <= withinDays * 24 * 60 * 60 * 1000;
}

/**
 * Run all five quality gates. `existingBodies` are the bodies of already-saved
 * AMIPS pages for the same make + model + metro (uniqueness comparison set);
 * pass an empty array when none exist.
 */
export function runQualityGates(
  article: GeneratedAmipsArticle,
  data: AmipsPageData,
  existingBodies: string[] = [],
): QualityGateResult {
  const failedGates: string[] = [];
  const warnings: string[] = [];
  let cleanedBody = article.body;
  const isMetro = METRO_TIERS.has(data.tier);

  // Gate 1 — Data Token Minimum: at least 3 real numbers referenced.
  if ((article.dataTokensUsed?.length ?? 0) < 3) {
    failedGates.push("Gate 1: Insufficient real data tokens referenced");
  }

  // Gate 2 — Uniqueness: not substantially similar to an existing page for the
  // same vehicle + metro.
  let duplicate = false;
  for (const other of existingBodies) {
    if (similarity(cleanedBody, other) > 0.8) {
      duplicate = true;
      break;
    }
  }
  if (duplicate) {
    failedGates.push("Gate 2: Content too similar to existing page");
  }

  // Gate 3 — Compliance: strip soft violations, hard-fail on guarantees, flag
  // undated APR claims.
  let stripped = false;
  for (const { re } of STRIP_PATTERNS) {
    if (re.test(cleanedBody)) {
      cleanedBody = cleanedBody.replace(re, "");
      stripped = true;
    }
  }
  if (stripped) warnings.push("Compliance content stripped");
  if (UNDATED_APR_PATTERN.test(cleanedBody)) {
    warnings.push("Undated APR claim flagged — verify expiration");
  }
  if (HARD_FAIL_PATTERN.test(cleanedBody)) {
    failedGates.push("Gate 3: Non-compliant 'guaranteed' claim");
  }

  // Gate 4 — CTA Presence + Supply-State Match: exactly the CTA type that
  // matches dealer supply must appear in the body.
  const body = cleanedBody.toLowerCase();
  const hasRequestOffers = /compet(?:e|ing|ition)/.test(body);
  const hasWaitlist = /early[ -]access|waitlist|early access list/.test(body);
  if (data.ctaType === "request_offers" && !hasRequestOffers) {
    failedGates.push("Gate 4: Missing or mismatched CTA (expected request_offers)");
  } else if (data.ctaType === "join_waitlist" && !hasWaitlist) {
    failedGates.push("Gate 4: Missing or mismatched CTA (expected join_waitlist)");
  }

  // Gate 5 — Freshness: vehicle (all tiers), dealer + market (metro tiers).
  if (!isFresh(data.vehicleDataAsOf, FRESHNESS_DAYS.vehicle)) {
    failedGates.push("Gate 5: Stale data source: vehicle");
  } else if (isMetro) {
    if (!isFresh(data.dealerDataAsOf, FRESHNESS_DAYS.dealer)) {
      failedGates.push("Gate 5: Stale data source: dealer");
    } else if (!isFresh(data.marketDataAsOf, FRESHNESS_DAYS.market)) {
      failedGates.push("Gate 5: Stale data source: market");
    }
  }

  const score = 5 - failedGates.length;
  const status: QualityGateResult["status"] =
    score >= 5 ? "PUBLISHED" : score === 4 ? "REVIEW_NEEDED" : "FAILED";

  return {
    passed: failedGates.length === 0,
    score,
    failedGates,
    warnings,
    status,
    cleanedBody,
  };
}
