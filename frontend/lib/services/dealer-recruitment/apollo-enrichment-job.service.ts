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
//   left. The loop stops AT the cap and records ABORTED_CAP with a reason —
//   never silently.
//
//   IDEMPOTENT ON THE PERSON. The guard keys on apollo_person_id, not on the
//   prospect or candidate row: one Apollo person can surface under two rooftops,
//   and a per-row guard would pay for them twice.
//
//   CONSERVATIVE ACCOUNTING. A reveal that throws still counts a credit. We
//   cannot know whether Apollo billed, and undercounting spend is the failure
//   that overruns the cap.
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
  remainingCredits,
  type CreditConsumer,
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
  creditsSpent: number;
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
 * Report what a run WOULD do. Spends nothing and calls no billable endpoint, so
 * the admin confirms an exact number before any money moves.
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
  const consumer: CreditConsumer = input.consumer ?? "backfill";
  const ledgerRemaining = deps?.ledgerRemaining ?? defaultLedgerRemaining(now, consumer, prisma);
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

  for (const c of rows) {
    if (result.creditsSpent >= cap) {
      result.status = "ABORTED_CAP";
      result.abortReason =
        `reached the credit cap of ${cap} after ${result.creditsSpent} credit(s); ` +
        `${rows.length - result.enrichedCount - result.emptyCount - result.failedCount} candidate(s) not attempted`;
      logger.warn(`[apollo-enrich] ${result.abortReason}`);
      return finish(result);
    }

    if (await isPersonAlreadyEnriched(c.apolloPersonId)) continue;

    // The credit is counted BEFORE the call. If the call throws we cannot know
    // whether Apollo billed, and undercounting is what overruns a cap.
    result.creditsSpent += REVEAL_COST_CREDITS;

    let revealed: EnrichmentRevealResult | null;
    try {
      revealed = await reveal(c.apolloPersonId, { waterfall: isWaterfall });
    } catch (err) {
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
      `${result.creditsSpent}/${cap} credits`,
  );
  return finish(result);
}
