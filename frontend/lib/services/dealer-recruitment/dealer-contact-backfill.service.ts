// B′ — dealer contact backfill.
//
// Off-peak, budget-capped gap-fill of dealer contacts, in two phases per run:
//
//   Phase 0 (FREE) — canonical rooftop resolution + existing-contact reconcile.
//     Registered Dealers and DealerProspects that have no canonical A2
//     DealerRooftop yet (rooftopId = null) are resolved to one via the SAME shared
//     resolver the rest of the platform uses (resolveRooftop). Dealers are resolved
//     FIRST so a registered dealer anchors the rooftop and its prospect twin dedups
//     ONTO it — that cross-pool collapse is what prevents paying Apollo twice for
//     one physical dealership. Each resolved prospect's already-known contact.* is
//     then reconciled into the rooftop-keyed DealerContactProfile
//     (reconcileProspectContact), so existing/free contact data is preserved and
//     consulted BEFORE any paid reveal. No Apollo, no LLM — pure identity work.
//
//   Phase 1 (PAID, gated) — the gap-fill reveal. DealerRooftops that STILL have no
//     send-safe contact profile are revealed via the gated Apollo path the live
//     waterfall uses (revealRooftopContact), tagged consumer="backfill" so it can
//     only draw against the leftover budget above the live reserve floor.
//
// Why rooftop-keyed: the reveal, the reveal-cache, and DealerContactProfile are all
// keyed to the canonical A2 DealerRooftop, so filling a rooftop's contact benefits
// both its registered Dealer and its prospect twin at once and can never create a
// duplicate. websiteHost + city/state feed Apollo's org resolution. Phase 0 is what
// makes that guarantee real for the whole population: without a resolved rooftop a
// Dealer/Prospect is invisible to the rooftop-keyed reveal (and to coverage dedup).
//
// Scope: GAP-FILL ONLY. Free contact ENRICHMENT (role-derivation, Gemini) remains
// owned by the live coverage waterfall (resolveContactableEmail) — Phase 0 only
// RESOLVES identity + PRESERVES contacts already discovered, it does not re-run that
// enrichment here (no duplicate system). Stale-contact re-verification
// (CONTACT_STALE_MONTHS) is likewise owned by the live waterfall. OFF until Apollo
// is enabled + the probe cap is set — when off it neither queries nor spends nor
// resolves.

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { SEND_SAFE_STATUSES } from "./contact-resolution.service";
import { apolloEnabled } from "./apollo.service";
import { revealRooftopContact, REVEAL_COST_CREDITS } from "./apollo-reveal.service";
import { remainingCredits, cycleKeyFor } from "./apollo-credit-ledger.service";
import { upsertContactProfile, reconcileProspectContact } from "@/lib/services/dealer/dealer-contact-profile.service";
import { resolveRooftop } from "@/lib/services/dealer/dealer-rooftop.service";

// Iteration safety cap (independent of the budget cap) so a single run can never
// churn the whole rooftop table. The real spend ceiling is the ledger budget.
export const DEFAULT_BACKFILL_LIMIT = 100;

// Per-run bound on Phase 0 identity work (dealers + prospects resolved). Phase 0 is
// free but does several DB round-trips per candidate, so a single serverless
// invocation resolves at most this many; unresolved records drain over subsequent
// runs (each resolved record gains a rooftopId and drops out of the next scan).
export const DEFAULT_RESOLVE_LIMIT = 300;

// Bounds how many gap rooftops a single run pulls into memory to rank. Deterministic
// (oldest gaps first) so a re-run sees the same window; the priority sort then
// reorders within it. Far above any realistic per-run budget.
export const MAX_CANDIDATE_SCAN = 5000;

// Prospect statuses excluded from Phase 0 resolution: DEAD (do-not-contact) and
// ONBOARDED (already became a registered Dealer — the rooftop comes from the dealer
// side). Mirrors the live coverage query's exclusion so the two agree.
export const PROSPECT_RESOLVE_EXCLUDE = ["DEAD", "ONBOARDED"] as const;

export interface BackfillParams {
  limit?: number;
  /** Per-run bound on Phase 0 rooftop-resolution work (dealers + prospects). */
  resolveLimit?: number;
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
  // Phase 0 — injectable so unit tests never touch prisma / the real resolver.
  resolveRooftop: typeof resolveRooftop;
  reconcile: typeof reconcileProspectContact;
}

export interface BackfillResult {
  enabled: boolean;
  // Phase 0 — canonical rooftop resolution.
  dealersResolved: number;
  prospectsResolved: number;
  contactsReconciled: number;
  resolveFailed: number;
  // Phase 1 — paid gap-fill reveal.
  candidates: number;
  attempted: number;
  revealed: number;
  skipped: number;
  stoppedForBudget: boolean;
}

interface ResolveCounts {
  dealersResolved: number;
  prospectsResolved: number;
  contactsReconciled: number;
  resolveFailed: number;
}

// Fields resolveRooftop needs from each population record (kept minimal).
interface DealerRow {
  id: string;
  dealershipName: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}
interface ProspectRow {
  id: string;
  name: string;
  website: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
}

/**
 * Phase 0 — resolve the Dealer + Prospect population that has no canonical rooftop
 * yet, dealers first (dedup anchor), then reconcile each resolved prospect's
 * existing contact into the rooftop profile. Bounded by `resolveLimit`, fail-open
 * per candidate (one bad record never aborts the run), idempotent (a resolved
 * record gains a rooftopId and is not re-selected).
 */
async function resolveDealerPopulation(
  deps: Pick<BackfillDeps, "prisma" | "resolveRooftop" | "reconcile">,
  resolveLimit: number,
): Promise<ResolveCounts> {
  const { prisma, resolveRooftop: resolve, reconcile } = deps;
  const counts: ResolveCounts = {
    dealersResolved: 0,
    prospectsResolved: 0,
    contactsReconciled: 0,
    resolveFailed: 0,
  };
  let budget = resolveLimit;
  if (budget <= 0) return counts;

  // Real registered dealers without a rooftop, resolved FIRST so a registered
  // dealer wins the canonical rooftop and any prospect twin dedups onto it.
  const dealers = (await prisma.dealer.findMany({
    where: { rooftopId: null, isSystemPlaceholder: false },
    select: { id: true, dealershipName: true, city: true, state: true, zip: true, phone: true, latitude: true, longitude: true },
    orderBy: { createdAt: "asc" },
    take: budget,
  })) as DealerRow[];
  for (const d of dealers) {
    if (budget <= 0) return counts;
    budget--;
    try {
      // Dealer has no website field — host key is absent; matching falls to
      // name+zip / name+city+state / phone (all handled by the resolver).
      const rid = await resolve(
        { kind: "dealer", id: d.id, name: d.dealershipName, zip: d.zip, city: d.city, state: d.state, phone: d.phone, latitude: d.latitude, longitude: d.longitude },
        { prisma },
      );
      if (rid) counts.dealersResolved++;
    } catch (err) {
      counts.resolveFailed++;
      logger.warn(`[dealer-contact-backfill] rooftop resolve failed for dealer ${d.id}:`, err);
    }
  }

  if (budget <= 0) return counts;

  const prospects = (await prisma.dealerProspect.findMany({
    where: { rooftopId: null, status: { notIn: [...PROSPECT_RESOLVE_EXCLUDE] } },
    select: { id: true, name: true, website: true, city: true, state: true, zip: true, phone: true, latitude: true, longitude: true },
    orderBy: { createdAt: "asc" },
    take: budget,
  })) as ProspectRow[];
  for (const p of prospects) {
    if (budget <= 0) return counts;
    budget--;
    try {
      const rid = await resolve(
        { kind: "prospect", id: p.id, name: p.name, website: p.website, zip: p.zip, city: p.city, state: p.state, phone: p.phone, latitude: p.latitude, longitude: p.longitude },
        { prisma },
      );
      if (!rid) continue;
      counts.prospectsResolved++;
      // Preserve any already-known contact for this prospect into the rooftop
      // profile (never-downgrade merge). Preservation-only and fail-open — a
      // reconcile miss must never fail the resolution it rode in on.
      try {
        const rec = await reconcile(p.id, { prisma });
        if (rec) counts.contactsReconciled++;
      } catch (err) {
        logger.warn(`[dealer-contact-backfill] contact reconcile failed for prospect ${p.id}:`, err);
      }
    } catch (err) {
      counts.resolveFailed++;
      logger.warn(`[dealer-contact-backfill] rooftop resolve failed for prospect ${p.id}:`, err);
    }
  }

  return counts;
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
  const resolve = deps?.resolveRooftop ?? resolveRooftop;
  const reconcile = deps?.reconcile ?? reconcileProspectContact;

  const limit = params.limit ?? DEFAULT_BACKFILL_LIMIT;
  const resolveLimit = params.resolveLimit ?? DEFAULT_RESOLVE_LIMIT;
  const priorityMakes = (params.priorityMakes ?? []).map((m) => m.toLowerCase());
  const priorityStates = (params.priorityStates ?? []).map((s) => s.toUpperCase());

  const result: BackfillResult = {
    enabled: false,
    dealersResolved: 0,
    prospectsResolved: 0,
    contactsReconciled: 0,
    resolveFailed: 0,
    candidates: 0,
    attempted: 0,
    revealed: 0,
    skipped: 0,
    stoppedForBudget: false,
  };

  // Off/capped until enabled + probe cap set — never iterate, resolve, or spend
  // when off (the whole job is inert until the owner turns Apollo on).
  if (!enabled()) return result;
  result.enabled = true;

  // Phase 0 (FREE) — resolve canonical rooftops for the Dealer + Prospect
  // population and preserve existing contacts into the rooftop profile. Fail-open
  // at the top level too: a Phase 0 breakage must not stop the Phase 1 gap-fill
  // over rooftops resolved on earlier runs.
  try {
    const r0 = await resolveDealerPopulation({ prisma, resolveRooftop: resolve, reconcile }, resolveLimit);
    result.dealersResolved = r0.dealersResolved;
    result.prospectsResolved = r0.prospectsResolved;
    result.contactsReconciled = r0.contactsReconciled;
    result.resolveFailed = r0.resolveFailed;
  } catch (err) {
    logger.warn("[dealer-contact-backfill] Phase 0 rooftop resolution failed — continuing to gap-fill:", err);
  }

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
    `[dealer-contact-backfill] cycle=${cycleKey} ` +
      `resolved(dealers=${result.dealersResolved} prospects=${result.prospectsResolved} ` +
      `reconciled=${result.contactsReconciled} failed=${result.resolveFailed}) ` +
      `candidates=${result.candidates} attempted=${result.attempted} revealed=${result.revealed} ` +
      `skipped=${result.skipped} budgetStop=${result.stoppedForBudget}`,
  );
  return result;
}
