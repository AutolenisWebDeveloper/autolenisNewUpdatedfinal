// Phase 1.4 — credit-budgeted Apollo enrichment.
//
// This is the ONLY place in the dealer pipeline that spends money, so it is
// written defensively throughout:
//
//   PREVIEW FIRST. previewEnrichment() reveals nothing and reports the exact
//   candidate count and worst-case cost, so the admin confirms a number rather
//   than a promise. A spend is never one click away.
//
//   HARD CAP. The effective cap is the MINIMUM of the caller's request, the
//   configured APOLLO_ENRICHMENT_MAX_CREDITS, and what the monthly ledger has
//   left. It bounds credits DRAWN — paid calls made, credits put at risk —
//   not the net that remains after refunds, so a long run of free no-matches
//   still stops after `cap` calls. The loop stops AT the cap and records
//   ABORTED_CAP with a reason — never silently.
//
//   IDEMPOTENT ON THE PERSON. The guard keys on apollo_person_id, not on the
//   prospect or candidate row: one Apollo person can surface under two rooftops,
//   and a per-row guard would pay for them twice.
//
//   THE DRAW PRECEDES THE CALL. One people/match credit is drawn from
//   ApolloCreditLedger — the same atomic conditional draw the rooftop reveal
//   and the contract probe use — BEFORE every paid call. The cap above is a
//   ceiling computed from a balance READ at run start; the draw is what makes
//   it safe, because two runs in one cycle contend for one ledger instead of
//   each seeing the full balance. A refused draw ends the run: the candidate
//   is marked SKIPPED_CAP, nothing is asked of Apollo, and the run records
//   ABORTED_CAP with how many candidates went unattempted.
//
//   THIS PATH DOES NOT GO THROUGH revealRooftopContact. ApolloReveal is unique
//   on (rooftopId, cycleKey) — one claim per rooftop per month — while
//   enrichment is keyed on apolloPersonId and a rooftop can legitimately hold
//   two candidates. Reusing the rooftop path would either block the second
//   person for the cycle or file a person's result in the rooftop-scoped
//   cache the live waterfall serves. The two paths share only the ledger.
//
//   CONSERVATIVE ACCOUNTING, matching apollo-reveal.service. A reveal that
//   throws KEEPS its credit: we cannot know whether Apollo billed, and
//   undercounting spend is the failure that overruns the cap. A match with no
//   email keeps it too — Apollo bills the match. Only a clean no-match, which
//   Apollo documents as free, is refunded. creditsDrawn is the gross, and
//   creditsSpent the NET of what the run drew, so apollo_enrichment_runs
//   reconciles against the ledger. One honest limit: the wired refundCredits
//   swallows its own database error, so a refund the ledger rejected cannot
//   be seen from here (reported, not fixed — the ledger's contract is out of
//   this batch's scope). Money direction stays safe: the ledger keeps the
//   credit; only the run row can under-report by one.
//
//   MATCH CONFIDENCE GATES THE SPEND. Measured against production, an Apollo
//   People Search for SIC 5511 in Texas resolved 13 of 86 organizations (15.1%)
//   to an existing rooftop by name; most of the remainder are parent groups
//   ("AutoNation", "Hendrick Automotive Group") whose people cannot be
//   attributed to a single store. Enriching a low-confidence or freshly-created
//   link buys a contact filed under the wrong dealership, so those are skipped
//   unless the caller explicitly opts in.

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  cycleKeyFor,
  daysInCycleFor,
  drawCredits,
  refundCredits,
  remainingCredits,
  type CreditConsumer,
  type DrawResult,
} from "./apollo-credit-ledger.service";

/** One standard reveal. Matches REVEAL_COST_CREDITS in apollo-reveal.service. */
export const REVEAL_COST_CREDITS = 1;

/** Re-enrich only past this age. */
export const ENRICHMENT_STALENESS_DAYS = 90;

/**
 * Worst-case multiplier used when estimating a WATERFALL run.
 *
 * Waterfall cascades to partner providers at a variable, plan-dependent
 * per-contact cost that can exceed a standard match. The exact figure is not
 * knowable ahead of time, so the preview deliberately OVER-estimates: showing an
 * admin a number the run can exceed is the one failure mode that matters here.
 */
export const WATERFALL_WORST_CASE_MULTIPLIER = 8;

/** Fallback cap when APOLLO_ENRICHMENT_MAX_CREDITS is unset or nonsensical. */
export const DEFAULT_MAX_CREDITS = 100;

export type EnrichmentPriorityTier = 1 | 2 | 3 | 4;

export interface EnrichmentCandidate {
  id: string;
  apolloPersonId: string;
  rooftopId: string | null;
  matchMethod: string | null;
  matchConfidence: string | null;
  enrichmentStatus: string;
  lastSyncedAt: Date | null;
  /** 1 = linked to an active buyer opportunity, 2 = SCRIPTED, 3 = scored, 4 = DISCOVERED. */
  priorityTier: EnrichmentPriorityTier;
}

export interface EnrichmentRevealResult {
  email: string | null;
  phone: string | null;
  dncStatus: string | null;
  phoneType: string | null;
}

export interface EnrichmentInput {
  maxCredits?: number;
  /** Opt in to enriching low-confidence / created rooftop links. Default false. */
  includeWeakMatches?: boolean;
  consumer?: CreditConsumer;
  startedBy?: string;
}

export interface EnrichmentPreview {
  candidateCount: number;
  worstCaseCredits: number;
  creditsRemaining: number;
  waterfallEnabled: boolean;
  maxCredits: number;
}

export interface EnrichmentRunResult {
  status: "COMPLETED" | "ABORTED_CAP" | "ABORTED_ERROR" | "ABORTED_DISABLED";
  abortReason?: string;
  candidateCount: number;
  /**
   * INVARIANT: the NET credits this run drew from ApolloCreditLedger — every
   * draw adds REVEAL_COST_CREDITS, every refund subtracts it. This is the
   * number written to apollo_enrichment_runs.credits_spent, so the run rows
   * reconcile against the ledger. It is never an estimate of what Apollo
   * charged.
   */
  creditsSpent: number;
  /**
   * GROSS credits drawn — the paid calls this run made. This, not the net, is
   * what the cap bounds: maxCredits authorizes how many credits may be put at
   * risk, and a free outcome coming back does not buy another call.
   * creditsDrawn === creditsSpent + creditsRefunded.
   */
  creditsDrawn: number;
  /** Credits drawn and then returned for a clean no-match; already netted out of creditsSpent. */
  creditsRefunded: number;
  enrichedCount: number;
  emptyCount: number;
  failedCount: number;
  skippedWeakMatch: number;
  includedWeakMatches: boolean;
  maxCredits: number;
}

export interface EnrichmentDeps {
  prisma: PrismaClient;
  now: Date;
  enabled: () => boolean;
  waterfallEnabled: () => boolean;
  selectCandidates: () => Promise<EnrichmentCandidate[]>;
  isPersonAlreadyEnriched: (apolloPersonId: string) => Promise<boolean>;
  ledgerRemaining: () => Promise<number>;
  /**
   * Draw `cost` credits from this cycle's ApolloCreditLedger. { drawn: false }
   * is a refusal (no budget above the floor, or no ledger row); a throw means
   * the ledger itself failed. Only runEnrichment calls it, always BEFORE the
   * paid call; previewEnrichment has no path to it.
   */
  ledgerDraw: (cost: number) => Promise<DrawResult>;
  /** Return `cost` credits for the one outcome Apollo documents as free — a clean no-match. */
  ledgerRefund: (cost: number) => Promise<void>;
  reveal: (apolloPersonId: string, opts: { waterfall: boolean }) => Promise<EnrichmentRevealResult | null>;
  persistContact: (contact: {
    rooftopId: string;
    apolloPersonId: string;
    email: string | null;
    phone: string | null;
    dncStatus: string | null;
    dncCheckedAt: Date | null;
    phoneType: string | null;
    apolloLastSyncedAt: Date;
  }) => Promise<void>;
  updateCandidate: (id: string, data: Record<string, unknown>) => Promise<void>;
  persistRun: (run: Record<string, unknown>) => Promise<void>;
}

/** True only when configured AND explicitly enabled. Spending stays off by default. */
export function enrichmentEnabled(): boolean {
  return !!process.env.APOLLO_API_KEY && process.env.APOLLO_ENRICHMENT_ENABLED === "true";
}

/** Waterfall has its own flag, OFF by default — its per-contact cost is variable. */
export function waterfallEnabled(): boolean {
  return process.env.APOLLO_WATERFALL_ENABLED === "true";
}

/**
 * The configured cap. A missing, non-numeric, zero or negative value falls back
 * to DEFAULT_MAX_CREDITS rather than to "no cap": a misconfigured environment
 * must never be the reason an unbounded spend is permitted.
 */
export function resolveMaxCredits(): number {
  const raw = Number(process.env.APOLLO_ENRICHMENT_MAX_CREDITS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_CREDITS;
}

/** A link strong enough to spend against. */
function isStrongMatch(c: EnrichmentCandidate): boolean {
  if (!c.rooftopId) return false;
  if (c.matchMethod === "created" || c.matchMethod === "unmatchable") return false;
  return c.matchConfidence === "high" || c.matchConfidence === "medium";
}

function isStale(c: EnrichmentCandidate, now: Date): boolean {
  if (!c.lastSyncedAt) return true;
  return now.getTime() - c.lastSyncedAt.getTime() > ENRICHMENT_STALENESS_DAYS * 86_400_000;
}

/** Candidates eligible to spend on, in priority order. */
function eligible(
  candidates: EnrichmentCandidate[],
  now: Date,
  includeWeakMatches: boolean,
): { eligible: EnrichmentCandidate[]; skippedWeakMatch: number } {
  let skippedWeakMatch = 0;
  const out: EnrichmentCandidate[] = [];
  const seenPersons = new Set<string>();

  for (const c of candidates) {
    if (!isStale(c, now)) continue;
    if (!includeWeakMatches && !isStrongMatch(c)) {
      skippedWeakMatch += 1;
      continue;
    }
    // Two candidate rows for one Apollo person must produce ONE reveal.
    if (seenPersons.has(c.apolloPersonId)) continue;
    seenPersons.add(c.apolloPersonId);
    out.push(c);
  }

  out.sort((a, b) => a.priorityTier - b.priorityTier);
  return { eligible: out, skippedWeakMatch };
}

async function effectiveCap(
  requested: number | undefined,
  ledgerRemaining: () => Promise<number>,
): Promise<number> {
  const asked = Number.isFinite(requested) ? Math.floor(requested as number) : resolveMaxCredits();
  const remaining = await ledgerRemaining();
  return Math.max(0, Math.min(asked, resolveMaxCredits(), remaining));
}

function defaultLedgerRemaining(now: Date, consumer: CreditConsumer, prisma: PrismaClient) {
  return () => remainingCredits(cycleKeyFor(now), consumer, now, { prisma });
}

/**
 * The real draw, bound to the run's cycle and consumer. The cycle arithmetic
 * happens INSIDE the thunk so that a ledger failure of any kind surfaces as a
 * caught draw error in the loop — never as a throw out of runEnrichment that
 * would skip the run record.
 */
function defaultLedgerDraw(now: Date, consumer: CreditConsumer, prisma: PrismaClient) {
  return (cost: number) =>
    drawCredits(
      { cycleKey: cycleKeyFor(now), cost, consumer, day: now.getUTCDate(), daysInCycle: daysInCycleFor(now) },
      { prisma },
    );
}

function defaultLedgerRefund(now: Date, prisma: PrismaClient) {
  return (cost: number) => refundCredits(cycleKeyFor(now), cost, { prisma });
}

/**
 * Report what a run WOULD do. Spends nothing and calls no billable endpoint, so
 * the admin confirms an exact number before any money moves.
 *
 * No ledgerDraw or ledgerRefund is built or read here: a preview has no
 * dependency through which it could reach a draw or a refund. The isolation
 * test holds it to that with every ledger export throwing, with the balance
 * read injected exactly as the orchestration layer injects it.
 */
export async function previewEnrichment(
  input: EnrichmentInput,
  deps?: Partial<EnrichmentDeps>,
): Promise<EnrichmentPreview> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const consumer: CreditConsumer = input.consumer ?? "backfill";
  const isWaterfall = (deps?.waterfallEnabled ?? waterfallEnabled)();
  const ledgerRemaining = deps?.ledgerRemaining ?? defaultLedgerRemaining(now, consumer, prisma);
  const selectCandidates = deps?.selectCandidates ?? (async () => []);

  const cap = await effectiveCap(input.maxCredits, ledgerRemaining);
  const all = await selectCandidates();
  const { eligible: rows } = eligible(all, now, input.includeWeakMatches ?? false);

  const perContact = REVEAL_COST_CREDITS * (isWaterfall ? WATERFALL_WORST_CASE_MULTIPLIER : 1);
  const worstCaseCredits = Math.min(rows.length * perContact, cap);
  const creditsRemaining = await ledgerRemaining();

  const preview: EnrichmentPreview = {
    candidateCount: rows.length,
    worstCaseCredits,
    creditsRemaining,
    waterfallEnabled: isWaterfall,
    maxCredits: cap,
  };

  await (deps?.persistRun ?? (async () => {}))({
    mode: "preview",
    maxCredits: cap,
    candidateCount: rows.length,
    estimatedCost: worstCaseCredits,
    creditsSpent: 0,
    waterfallEnabled: isWaterfall,
    status: "COMPLETED",
    finishedAt: now,
    startedBy: input.startedBy ?? null,
  });

  return preview;
}

/**
 * Execute a capped enrichment run.
 *
 * Never throws: a per-candidate failure is recorded and the run continues, so one
 * unreachable person cannot strand the rest of a paid batch.
 */
export async function runEnrichment(
  input: EnrichmentInput,
  deps?: Partial<EnrichmentDeps>,
): Promise<EnrichmentRunResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const enabled = deps?.enabled ?? enrichmentEnabled;
  const isWaterfall = (deps?.waterfallEnabled ?? waterfallEnabled)();
  // The consumer decides the reserve floor the draw respects. "backfill" is the
  // default and what the admin route passes: bulk enrichment is exactly the
  // demand RESERVE_CREDITS holds budget back FROM, so an admin run may never
  // eat into what live, buyer-facing reveals need. Only a caller that IS live
  // demand passes "live".
  const consumer: CreditConsumer = input.consumer ?? "backfill";
  const ledgerRemaining = deps?.ledgerRemaining ?? defaultLedgerRemaining(now, consumer, prisma);
  const ledgerDraw = deps?.ledgerDraw ?? defaultLedgerDraw(now, consumer, prisma);
  const ledgerRefund = deps?.ledgerRefund ?? defaultLedgerRefund(now, prisma);
  const selectCandidates = deps?.selectCandidates ?? (async () => []);
  const isPersonAlreadyEnriched = deps?.isPersonAlreadyEnriched ?? (async () => false);
  const reveal = deps?.reveal;
  const persistContact = deps?.persistContact ?? (async () => {});
  const updateCandidate = deps?.updateCandidate ?? (async () => {});
  const persistRun = deps?.persistRun ?? (async () => {});

  const includedWeakMatches = input.includeWeakMatches ?? false;
  const cap = await effectiveCap(input.maxCredits, ledgerRemaining);

  const base: EnrichmentRunResult = {
    status: "COMPLETED",
    candidateCount: 0,
    creditsSpent: 0,
    creditsDrawn: 0,
    creditsRefunded: 0,
    enrichedCount: 0,
    emptyCount: 0,
    failedCount: 0,
    skippedWeakMatch: 0,
    includedWeakMatches,
    maxCredits: cap,
  };

  const finish = async (r: EnrichmentRunResult): Promise<EnrichmentRunResult> => {
    await persistRun({
      mode: "execute",
      maxCredits: r.maxCredits,
      candidateCount: r.candidateCount,
      estimatedCost: r.candidateCount * REVEAL_COST_CREDITS,
      creditsSpent: r.creditsSpent,
      enrichedCount: r.enrichedCount,
      emptyCount: r.emptyCount,
      failedCount: r.failedCount,
      waterfallEnabled: isWaterfall,
      status: r.status,
      abortReason: r.abortReason ?? null,
      finishedAt: now,
      startedBy: input.startedBy ?? null,
    });
    return r;
  };

  if (!enabled()) {
    logger.info("[apollo-enrich] APOLLO_ENRICHMENT_ENABLED is not true — nothing spent");
    return finish({ ...base, status: "ABORTED_DISABLED", abortReason: "enrichment flag is off" });
  }
  if (!reveal) {
    return finish({ ...base, status: "ABORTED_ERROR", abortReason: "no reveal implementation supplied" });
  }
  if (cap <= 0) {
    return finish({
      ...base,
      status: "ABORTED_CAP",
      abortReason: "effective credit cap is zero (request, config, or ledger remaining)",
    });
  }

  const all = await selectCandidates();
  const { eligible: rows, skippedWeakMatch } = eligible(all, now, includedWeakMatches);

  const result: EnrichmentRunResult = { ...base, candidateCount: rows.length, skippedWeakMatch };

  for (let i = 0; i < rows.length; i++) {
    const c = rows[i];
    // This candidate and every one after it, should the run stop here.
    const unattempted = rows.length - i;

    // The cap bounds GROSS draws. A clean no-match refunds its credit, but that
    // refund must not buy another call: gating on the net would let a long run
    // of free outcomes make unbounded paid calls inside one request, and a
    // function killed mid-loop never reaches finish() — spend with no run row.
    if (result.creditsDrawn >= cap) {
      result.status = "ABORTED_CAP";
      result.abortReason =
        `reached the credit cap of ${cap}: ${result.creditsDrawn} credit(s) drawn ` +
        `(${result.creditsSpent} net after ${result.creditsRefunded} refunded); ` +
        `${unattempted} candidate(s) not attempted`;
      logger.warn(`[apollo-enrich] ${result.abortReason}`);
      return finish(result);
    }

    if (await isPersonAlreadyEnriched(c.apolloPersonId)) continue;

    // THE DRAW PRECEDES THE CALL. One people/match credit is taken from
    // ApolloCreditLedger atomically before Apollo is asked anything. The cap
    // above is the ceiling this run was quoted from a balance read at start;
    // the draw is what makes it safe when another run has spent since.
    let draw: DrawResult;
    try {
      draw = await ledgerDraw(REVEAL_COST_CREDITS);
    } catch (err) {
      // The ledger itself failed. Nothing was asked of Apollo and nothing was
      // billed, so this is ABORTED_ERROR, not ABORTED_CAP — "budget exhausted"
      // would send an operator looking at the wrong thing. The candidate is
      // left exactly as it was: it was never attempted.
      const message = err instanceof Error ? err.message : String(err);
      result.status = "ABORTED_ERROR";
      result.abortReason =
        `credit ledger draw failed (${message}) after ${result.creditsDrawn} draw(s); ` +
        `${unattempted} candidate(s) not attempted`;
      logger.error(`[apollo-enrich] ${result.abortReason}`);
      return finish(result);
    }
    if (!draw.drawn) {
      // The ledger refused: no budget above the reserve floor, or no ledger row
      // for the cycle. No Apollo call is made. SKIPPED_CAP is re-selectable by
      // the next run (ENRICHABLE_STATUSES); lastSyncedAt is deliberately NOT
      // written, because an unattempted candidate must not look fresh and hide
      // for ENRICHMENT_STALENESS_DAYS. The run stops here — never continue
      // past a failed draw.
      await updateCandidate(c.id, { enrichmentStatus: "SKIPPED_CAP" });
      result.status = "ABORTED_CAP";
      result.abortReason =
        `the credit ledger refused a ${REVEAL_COST_CREDITS}-credit draw (${draw.reason ?? "insufficient"}) ` +
        `after ${result.creditsDrawn} draw(s); ${unattempted} candidate(s) not attempted`;
      logger.warn(`[apollo-enrich] ${result.abortReason}`);
      return finish(result);
    }
    // INVARIANT: creditsSpent === creditsDrawn − creditsRefunded, kept draw by
    // draw. apollo_enrichment_runs.credits_spent is written from creditsSpent,
    // so the run rows sum to what this path took from ApolloCreditLedger.
    result.creditsDrawn += REVEAL_COST_CREDITS;
    result.creditsSpent += REVEAL_COST_CREDITS;

    let revealed: EnrichmentRevealResult | null;
    try {
      revealed = await reveal(c.apolloPersonId, { waterfall: isWaterfall });
    } catch (err) {
      // The credit STAYS drawn. We cannot know whether Apollo billed an errored
      // call, and undercounting is what overruns a cap.
      const message = err instanceof Error ? err.message : String(err);
      result.failedCount += 1;
      await updateCandidate(c.id, {
        enrichmentStatus: "FAILED",
        enrichmentError: message,
        lastSyncedAt: now,
      });
      logger.warn(`[apollo-enrich] reveal failed for ${c.apolloPersonId}: ${message}`);
      continue;
    }

    if (revealed === null) {
      // A clean no-match. people/match is documented to bill only when a
      // person matches, so this is the ONE outcome whose credit comes back.
      //
      // A refund dependency that THROWS keeps the credit counted here (the
      // ledger still holds it). The wired refundCredits, however, catches its
      // own database error and its guarded updateMany can match zero rows
      // without saying so — a refund the ledger rejected is invisible from
      // here, and the run row then under-reports the ledger by one. Reported
      // for an owner decision; changing the ledger's refund contract is out of
      // this batch's scope. The ledger side stays conservative either way.
      try {
        await ledgerRefund(REVEAL_COST_CREDITS);
        result.creditsSpent -= REVEAL_COST_CREDITS;
        result.creditsRefunded += REVEAL_COST_CREDITS;
      } catch (err) {
        logger.warn(`[apollo-enrich] refund failed for ${c.apolloPersonId} — credit kept:`, err);
      }
    }
    // A match with no email or phone bills like any match: that credit stays.

    if (!revealed || (!revealed.email && !revealed.phone)) {
      // Apollo returned nothing usable. Record it and move on — never invent a
      // contact detail to fill the gap.
      result.emptyCount += 1;
      if (c.rooftopId) {
        await persistContact({
          rooftopId: c.rooftopId,
          apolloPersonId: c.apolloPersonId,
          email: null,
          phone: null,
          dncStatus: revealed?.dncStatus ?? null,
          dncCheckedAt: revealed?.dncStatus ? now : null,
          phoneType: revealed?.phoneType ?? null,
          apolloLastSyncedAt: now,
        });
      }
      await updateCandidate(c.id, { enrichmentStatus: "UNREACHABLE", lastSyncedAt: now });
      continue;
    }

    if (c.rooftopId) {
      await persistContact({
        rooftopId: c.rooftopId,
        apolloPersonId: c.apolloPersonId,
        email: revealed.email,
        phone: revealed.phone,
        // Persisted VERBATIM. Only "not_found" clears the phone channel;
        // "pending" is not a clearance and null means never checked.
        dncStatus: revealed.dncStatus,
        dncCheckedAt: revealed.dncStatus ? now : null,
        phoneType: revealed.phoneType,
        apolloLastSyncedAt: now,
      });
    }
    await updateCandidate(c.id, { enrichmentStatus: "ENRICHED", lastSyncedAt: now });
    result.enrichedCount += 1;
  }

  logger.info(
    `[apollo-enrich] run complete: ${result.enrichedCount} enriched, ${result.emptyCount} unreachable, ` +
      `${result.failedCount} failed, ${result.skippedWeakMatch} skipped (weak match), ` +
      `${result.creditsDrawn}/${cap} credits drawn (${result.creditsSpent} net, ${result.creditsRefunded} refunded)`,
  );
  return finish(result);
}
