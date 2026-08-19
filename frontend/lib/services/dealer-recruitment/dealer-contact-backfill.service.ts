// B′ — dealer contact backfill.
//
// Off-peak, budget-capped gap-fill of rooftop contacts. Iterates DealerRooftops
// that have NO send-safe contact profile and reveals one via the SAME gated Apollo
// path the live waterfall uses (revealRooftopContact), tagged consumer="backfill"
// so it can only draw against the leftover budget above the live reserve floor.
//
// Why rooftop-keyed: the reveal, the reveal-cache, and DealerContactProfile are all
// keyed to the canonical A2 DealerRooftop, so filling a rooftop's contact benefits
// both its registered Dealer and its prospect twin at once and can never create a
// duplicate. websiteHost + city/state feed Apollo's org resolution.
//
// Scope: GAP-FILL ONLY. Stale-contact re-verification (CONTACT_STALE_MONTHS) is
// owned by the live waterfall (B2b bounce/staleness re-resolve) and is not
// duplicated here. OFF until Apollo is enabled + the probe cap is set — when off it
// neither queries nor spends.

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { SEND_SAFE_STATUSES } from "./contact-resolution.service";
import { apolloEnabled } from "./apollo.service";
import { revealRooftopContact, REVEAL_COST_CREDITS } from "./apollo-reveal.service";
import { remainingCredits, cycleKeyFor } from "./apollo-credit-ledger.service";
import { upsertContactProfile } from "@/lib/services/dealer/dealer-contact-profile.service";

// Iteration safety cap (independent of the budget cap) so a single run can never
// churn the whole rooftop table. The real spend ceiling is the ledger budget.
export const DEFAULT_BACKFILL_LIMIT = 100;

// Bounds how many gap rooftops a single run pulls into memory to rank. Deterministic
// (oldest gaps first) so a re-run sees the same window; the priority sort then
// reorders within it. Far above any realistic per-run budget.
export const MAX_CANDIDATE_SCAN = 5000;

export interface BackfillParams {
  limit?: number;
  /** Brand priority — rooftops carrying any of these makes go first (case-insensitive). */
  priorityMakes?: string[];
  /** Market priority — rooftops in any of these states go next (case-insensitive). */
  priorityStates?: string[];
}

export interface BackfillDeps {
  prisma: PrismaClient;
  now: Date;
  enabled: () => boolean;
  reveal: typeof revealRooftopContact;
  upsert: typeof upsertContactProfile;
  remaining: typeof remainingCredits;
}

export interface BackfillResult {
  enabled: boolean;
  candidates: number;
  attempted: number;
  revealed: number;
  skipped: number;
  stoppedForBudget: boolean;
}

interface CandidateRooftop {
  id: string;
  displayName: string;
  websiteHost: string | null;
  city: string | null;
  state: string | null;
  makes: string[];
  createdAt: Date;
}

export async function runDealerContactBackfill(
  params: BackfillParams = {},
  deps?: Partial<BackfillDeps>,
): Promise<BackfillResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const enabled = deps?.enabled ?? apolloEnabled;
  const reveal = deps?.reveal ?? revealRooftopContact;
  const upsert = deps?.upsert ?? upsertContactProfile;
  const remaining = deps?.remaining ?? remainingCredits;

  const limit = params.limit ?? DEFAULT_BACKFILL_LIMIT;
  const priorityMakes = (params.priorityMakes ?? []).map((m) => m.toLowerCase());
  const priorityStates = (params.priorityStates ?? []).map((s) => s.toUpperCase());

  const result: BackfillResult = {
    enabled: false,
    candidates: 0,
    attempted: 0,
    revealed: 0,
    skipped: 0,
    stoppedForBudget: false,
  };

  // Off/capped until enabled + probe cap set — never iterate or spend when off.
  if (!enabled()) return result;
  result.enabled = true;

  // Candidates = rooftops with NO send-safe contact (email present + send-safe
  // status). `none` returns rooftops with zero matching contacts, i.e. a real gap.
  const candidates = (await prisma.dealerRooftop.findMany({
    where: {
      contacts: {
        none: { email: { not: null }, emailVerificationStatus: { in: [...SEND_SAFE_STATUSES] } },
      },
    },
    select: { id: true, displayName: true, websiteHost: true, city: true, state: true, makes: true, createdAt: true },
    orderBy: { createdAt: "asc" }, // deterministic scan window; priority re-sorts within it
    take: MAX_CANDIDATE_SCAN,
  })) as CandidateRooftop[];
  if (candidates.length === 0) return result;

  const cycleKey = cycleKeyFor(now);

  // Drop rooftops already attempted THIS cycle with a terminal-null outcome
  // (EMPTY = genuine Apollo miss; PENDING = a claim held by another worker). The
  // reveal service would return null for them cheaply anyway, but re-selecting
  // them every run would let a wall of permanent misses consume the per-run
  // `limit` and starve resolvable rooftops behind them until the cycle rolls over.
  // REVEALED reveals are left in — their profile write may have failed, and a
  // re-run refills from the reveal-cache for free (no draw).
  const spent = await prisma.apolloReveal.findMany({
    where: { cycleKey, status: { in: ["EMPTY", "PENDING"] } },
    select: { rooftopId: true },
  });
  const attemptedThisCycle = new Set(spent.map((s) => s.rooftopId));
  const actionable = candidates.filter((r) => !attemptedThisCycle.has(r.id));
  result.candidates = actionable.length;
  if (actionable.length === 0) return result;

  // Transparent, non-discriminatory priority: brand + market demand only. +2 per
  // priority-make match, +1 for a priority state; stable createdAt tiebreak
  // (oldest first) so the order is deterministic and re-runs are reproducible.
  const score = (r: CandidateRooftop): number => {
    let s = 0;
    if (priorityMakes.length && r.makes.some((m) => priorityMakes.includes(m.toLowerCase()))) s += 2;
    if (priorityStates.length && r.state && priorityStates.includes(r.state.toUpperCase())) s += 1;
    return s;
  };
  const ordered = [...actionable].sort(
    (a, b) => score(b) - score(a) || a.createdAt.getTime() - b.createdAt.getTime(),
  );

  for (const r of ordered) {
    if (result.attempted >= limit) break; // iteration safety cap

    // Stop the whole run once backfill budget is exhausted, rather than churning a
    // futile reveal call per remaining rooftop. This is an optimization — the
    // reveal service remains the authoritative fail-closed guard against overspend
    // (its atomic draw releases the claim if a concurrent live draw beat us here).
    const budget = await remaining(cycleKey, "backfill", now, { prisma });
    if (budget < REVEAL_COST_CREDITS) {
      result.stoppedForBudget = true;
      break;
    }

    result.attempted++;
    let revealed: Awaited<ReturnType<typeof revealRooftopContact>> = null;
    try {
      revealed = await reveal(
        { rooftopId: r.id, name: r.displayName, website: r.websiteHost, city: r.city, state: r.state, consumer: "backfill" },
        { prisma, now },
      );
    } catch (err) {
      logger.warn(`[dealer-contact-backfill] reveal threw for rooftop ${r.id}:`, err);
    }
    if (!revealed?.email) {
      result.skipped++;
      continue;
    }

    try {
      await upsert(
        r.id,
        {
          name: revealed.contactName,
          title: revealed.contactTitle,
          email: revealed.email,
          emailVerificationStatus: "VERIFIED",
          emailVerifiedAt: now,
          emailSource: "apollo",
          contactSource: "apollo_backfill",
          contactConfidence: "high",
        },
        { prisma },
      );
      result.revealed++;
    } catch (err) {
      // The paid reveal is already cached on ApolloReveal, so the credit isn't
      // wasted; count this as skipped (not revealed) to keep the tally honest.
      logger.warn(`[dealer-contact-backfill] profile upsert failed for rooftop ${r.id}:`, err);
      result.skipped++;
    }
  }

  logger.info(
    `[dealer-contact-backfill] cycle=${cycleKey} candidates=${result.candidates} attempted=${result.attempted} revealed=${result.revealed} skipped=${result.skipped} budgetStop=${result.stoppedForBudget}`,
  );
  return result;
}
