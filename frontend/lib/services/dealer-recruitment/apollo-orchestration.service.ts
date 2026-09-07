// Phase 1.7 — the wiring layer that gives the Apollo People Search chain a
// production entry point.
//
// WHY THIS FILE EXISTS. Phases 1.2–1.4 built runPeopleSearch,
// matchApolloOrgToRooftop, previewEnrichment and runEnrichment as pure,
// dependency-injected units with NO default implementations for the dependencies
// that touch the database. Every one of them defaults to a no-op:
// selectCandidates returns [], persistContact does nothing, persistRun discards
// the record. Unit-tested and correct, but nothing in production ever called
// them, so apollo_person_candidates and apollo_enrichment_runs were both empty.
// This module supplies the real implementations and the two operations the admin
// routes call. It adds NO new business rules: the caps, the weak-match gate, the
// idempotency guard and the conservative credit accounting all stay where they
// were written.
//
// COST BOUNDARY, RESTATED. Search is FREE. Nothing in the search path may reach a
// billable endpoint or the credit ledger, and the route test asserts exactly
// that. Only executeApolloEnrichment can spend, and only when the owner has set
// BOTH APOLLO_ENRICHMENT_ENABLED and APOLLO_REVEAL_ENABLED.
//
// KNOWN GAP, DELIBERATELY NOT CLOSED HERE. runEnrichment counts its own spend
// against the cap it computed at start, but it does NOT draw from
// ApolloCreditLedger — only revealRooftopContact does. Two enrichment runs in one
// cycle therefore each see the full remaining balance. Closing that needs a draw
// inside runEnrichment's loop plus a SKIPPED_CAP path for budget exhaustion
// (which the schema already anticipates), i.e. a change to billing semantics,
// which this batch is explicitly not authorized to make. It is reported instead,
// as a condition on enabling enrichment.

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { upsertContactProfile } from "@/lib/services/dealer/dealer-contact-profile.service";
import {
  runPeopleSearch,
  type PeopleSearchInput,
  type PeopleSearchResult,
} from "./apollo-people-search.service";
import {
  matchApolloOrgToRooftop,
  type MatchConfidence,
  type MatchMethod,
  type OrgMatchResult,
} from "./apollo-org-match.service";
import {
  previewEnrichment,
  runEnrichment,
  enrichmentEnabled,
  waterfallEnabled,
  type EnrichmentCandidate,
  type EnrichmentDeps,
  type EnrichmentPreview,
  type EnrichmentPriorityTier,
  type EnrichmentRevealResult,
  type EnrichmentRunResult,
  ENRICHMENT_STALENESS_DAYS,
} from "./apollo-enrichment-job.service";
import { apolloPeopleSearchEnabled, defaultApolloClient } from "./apollo.service";

/**
 * Per-run ceiling on the rooftop-resolution pass. Matching is free and is
 * cached per organization, so this bounds serverless wall-clock and database
 * round-trips, not spend. Candidates beyond it keep rooftopId = null and are
 * picked up by the next run — nothing is lost.
 */
export const MAX_MATCH_PER_RUN = 5_000;

/**
 * Bound on the candidate window one enrichment pass pulls into memory to rank.
 * Deterministic (oldest first) so a re-run sees the same window. Mirrors the
 * contact backfill's MAX_CANDIDATE_SCAN.
 */
export const MAX_ENRICH_SCAN = 5_000;

/**
 * Candidate states this path may re-attempt.
 *
 * ENRICHED is excluded on purpose: we already hold contact detail we paid for,
 * and re-selecting it would put a second charge for the same person one cap
 * away. The async-reveal states (QUEUED, PENDING_REVEAL, EXPIRED,
 * UNKNOWN_REQUEST) are excluded because they belong to drainReveal — a
 * synchronous re-reveal of a person with an outstanding async request would pay
 * twice for one answer.
 */
export const ENRICHABLE_STATUSES = ["NEW", "FAILED", "SKIPPED_CAP", "UNREACHABLE", "EMPTY"] as const;

// ─── search + rooftop resolution ────────────────────────────────────────────

export interface SearchAndMatchInput {
  /**
   * Apollo `organization_locations` values, passed through VERBATIM. Apollo
   * expects human-readable locations ("Texas, US"), not postal abbreviations,
   * and this module deliberately does not translate: a silent mapping that
   * guessed Apollo's expected format wrong would return zero rows and look
   * exactly like a market with no dealers.
   */
  organizationLocations: string[];
  titles?: string[];
  sicCodes?: string[];
  maxPages?: number;
}

export interface MatchHistogram {
  /** Candidates this pass resolved (bounded by MAX_MATCH_PER_RUN). */
  processed: number;
  /** Distinct Apollo organizations behind those candidates. */
  organizations: number;
  byConfidence: Record<MatchConfidence, number>;
  byMethod: Record<MatchMethod, number>;
  /** Linked to an EXISTING rooftop at high/medium confidence — the only ones
   *  enrichment will spend on while includeWeakMatches stays false. */
  strongMatch: number;
  /** strongMatch / processed, 0–1, rounded to 3 dp. 0 when nothing processed. */
  strongMatchRate: number;
  /** Matched a key shared by more than one rooftop (demoted to low). */
  ambiguous: number;
}

export interface SearchAndMatchResult {
  search: PeopleSearchResult;
  match: MatchHistogram;
  /** Set when the resolution pass failed; the search result still stands. */
  matchError?: string;
}

export interface OrchestrationDeps {
  prisma: PrismaClient;
  now: Date;
  search: typeof runPeopleSearch;
  matchOrg: typeof matchApolloOrgToRooftop;
}

const emptyHistogram = (): MatchHistogram => ({
  processed: 0,
  organizations: 0,
  byConfidence: { high: 0, medium: 0, low: 0 },
  byMethod: {
    website_host: 0,
    name_zip: 0,
    name_city_state: 0,
    phone: 0,
    created: 0,
    unmatchable: 0,
  },
  strongMatch: 0,
  strongMatchRate: 0,
  ambiguous: 0,
});

/**
 * The strong-match rule, declared ONCE.
 *
 * It restates isStrongMatch() inside apollo-enrichment-job (which is private to
 * that module and takes a different shape), so the two are pinned together by a
 * test that runs real candidates through previewEnrichment and asserts the counts
 * agree. Two copies that can drift silently is how a report starts promising a
 * spendable pool the job will not spend on.
 */
export const STRONG_MATCH_CONFIDENCES = ["high", "medium"] as const;
export const WEAK_MATCH_METHODS = ["created", "unmatchable"] as const;

function isStrongLink(m: {
  rooftopId: string | null;
  method: string | null;
  confidence: string | null;
}): boolean {
  if (!m.rooftopId) return false;
  if (WEAK_MATCH_METHODS.includes(m.method as (typeof WEAK_MATCH_METHODS)[number])) return false;
  return STRONG_MATCH_CONFIDENCES.includes(m.confidence as (typeof STRONG_MATCH_CONFIDENCES)[number]);
}

/**
 * Resolve every candidate of a search run that has no rooftop yet, recording the
 * method and confidence on each.
 *
 * Matching is cached per Apollo organization: a search for one state returns many
 * people from the same rooftop, and calling the matcher per person would both
 * hammer the database and — for an organization with no existing match — race
 * itself into creating several rooftops for one dealership.
 */
export async function resolveCandidateRooftops(
  searchRunKey: string,
  deps?: Partial<OrchestrationDeps>,
): Promise<MatchHistogram> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const matchOrg = deps?.matchOrg ?? matchApolloOrgToRooftop;

  const rows = await prisma.apolloPersonCandidate.findMany({
    where: { searchRunKey, rooftopId: null },
    select: {
      id: true,
      apolloOrganizationId: true,
      organizationName: true,
      organizationDomain: true,
      organizationCity: true,
      organizationState: true,
      organizationZip: true,
    },
    orderBy: { createdAt: "asc" },
    take: MAX_MATCH_PER_RUN,
  });

  const hist = emptyHistogram();
  const cache = new Map<string, OrgMatchResult>();

  for (const row of rows) {
    // Key on Apollo's organization id when present; otherwise on the identity
    // fields the matcher actually reads, so two candidates carrying the same
    // organization still share one resolution.
    const key =
      row.apolloOrganizationId ??
      [
        row.organizationName,
        row.organizationDomain,
        row.organizationCity,
        row.organizationState,
        row.organizationZip,
      ].join("|");

    let match = cache.get(key);
    if (!match) {
      match = await matchOrg(
        {
          name: row.organizationName,
          domain: row.organizationDomain,
          city: row.organizationCity,
          state: row.organizationState,
          zip: row.organizationZip,
          // People Search returns no organization phone, so the phone key is
          // simply unavailable here — not withheld.
          phone: null,
        },
        { prisma },
      );
      cache.set(key, match);
    }

    hist.processed += 1;
    hist.byMethod[match.method] += 1;
    hist.byConfidence[match.confidence] += 1;
    if (match.ambiguous) hist.ambiguous += 1;
    if (isStrongLink({ rooftopId: match.rooftopId, method: match.method, confidence: match.confidence }))
      hist.strongMatch += 1;

    // Persist the outcome even when nothing matched: matchMethod
    // "unmatchable" is a recorded finding, not a gap to re-derive later.
    try {
      await prisma.apolloPersonCandidate.update({
        where: { id: row.id },
        data: {
          rooftopId: match.rooftopId,
          matchMethod: match.method,
          matchConfidence: match.confidence,
        },
      });
    } catch (err) {
      // One row that will not write must not abandon the rest of a free pass.
      logger.warn(`[apollo-orchestration] candidate ${row.id} match write failed:`, err);
    }
  }

  hist.organizations = cache.size;
  hist.strongMatchRate =
    hist.processed > 0 ? Math.round((hist.strongMatch / hist.processed) * 1000) / 1000 : 0;

  logger.info(
    `[apollo-orchestration] run ${searchRunKey} matched ${hist.processed} candidate(s) across ` +
      `${hist.organizations} organization(s): strong=${hist.strongMatch} ` +
      `created=${hist.byMethod.created} unmatchable=${hist.byMethod.unmatchable} ` +
      `ambiguous=${hist.ambiguous}`,
  );
  return hist;
}

/**
 * The FREE acquisition operation: run a People Search, then resolve every new
 * candidate to a rooftop and report the confidence histogram.
 *
 * The histogram is the point. Enrichment only spends on high/medium links to an
 * EXISTING rooftop, so the strong-match rate is what tells the owner whether
 * authorizing spend would buy contacts or noise — before any money moves.
 */
export async function runPeopleSearchAndMatch(
  input: SearchAndMatchInput,
  deps?: Partial<OrchestrationDeps>,
): Promise<SearchAndMatchResult> {
  const search = deps?.search ?? runPeopleSearch;

  const searchInput: PeopleSearchInput = {
    organizationLocations: input.organizationLocations,
    ...(input.titles?.length ? { titles: input.titles } : {}),
    ...(input.sicCodes?.length ? { sicCodes: input.sicCodes } : {}),
    ...(input.maxPages !== undefined ? { maxPages: input.maxPages } : {}),
  };

  const result = await search(searchInput, { prisma: deps?.prisma });

  // A skipped search persisted nothing, so there is nothing to resolve.
  if (result.skipped) return { search: result, match: emptyHistogram() };

  try {
    return { search: result, match: await resolveCandidateRooftops(result.searchRunKey, deps) };
  } catch (err) {
    // The search itself succeeded and its rows are free, valid data. Report the
    // resolution failure rather than discarding a good search behind it.
    const matchError = err instanceof Error ? err.message : String(err);
    logger.warn(`[apollo-orchestration] rooftop resolution failed for ${result.searchRunKey}: ${matchError}`);
    return { search: result, match: emptyHistogram(), matchError };
  }
}

// ─── enrichment dependency implementations ──────────────────────────────────

/**
 * Priority tier for a rooftop, from its prospect population.
 *
 * 1 = a prospect tied to a live buyer opportunity, 2 = SCRIPTED (ready to
 * contact), 3 = scored, 4 = everything else. Read once for the whole candidate
 * window rather than per candidate.
 */
async function priorityTiersByRooftop(
  rooftopIds: string[],
  prisma: PrismaClient,
): Promise<Map<string, EnrichmentPriorityTier>> {
  const tiers = new Map<string, EnrichmentPriorityTier>();
  if (rooftopIds.length === 0) return tiers;

  const prospects = await prisma.dealerProspect.findMany({
    where: { rooftopId: { in: rooftopIds } },
    select: { rooftopId: true, status: true, buyerOppId: true, searchScore: true },
  });

  for (const p of prospects) {
    if (!p.rooftopId) continue;
    // A dead or already-onboarded prospect is not live demand, whatever else it
    // carries — it must not pull a rooftop to the front of a paid queue.
    const live = p.status !== "DEAD" && p.status !== "ONBOARDED";
    let tier: EnrichmentPriorityTier = 4;
    if (live && p.buyerOppId) tier = 1;
    else if (live && p.status === "SCRIPTED") tier = 2;
    else if (p.searchScore != null) tier = 3;

    const current = tiers.get(p.rooftopId);
    // Best (lowest) tier any prospect on the rooftop earns.
    if (current === undefined || tier < current) tiers.set(p.rooftopId, tier);
  }
  return tiers;
}

/**
 * The candidate window an enrichment pass ranks.
 *
 * Deliberately NOT pre-filtered to strong matches: the job's own eligible() gate
 * counts what it rejects as skippedWeakMatch, and filtering here would report
 * that as zero — hiding from the owner exactly how much of the population the
 * match step could not place.
 */
export async function selectEnrichmentCandidates(
  deps?: Partial<OrchestrationDeps>,
): Promise<EnrichmentCandidate[]> {
  const prisma = deps?.prisma ?? defaultPrisma;

  const rows = await prisma.apolloPersonCandidate.findMany({
    where: { enrichmentStatus: { in: [...ENRICHABLE_STATUSES] } },
    select: {
      id: true,
      apolloPersonId: true,
      rooftopId: true,
      matchMethod: true,
      matchConfidence: true,
      enrichmentStatus: true,
      lastSyncedAt: true,
    },
    orderBy: { createdAt: "asc" },
    take: MAX_ENRICH_SCAN,
  });

  const rooftopIds = [...new Set(rows.map((r) => r.rooftopId).filter((v): v is string => !!v))];
  const tiers = await priorityTiersByRooftop(rooftopIds, prisma);

  return rows.map((r) => ({
    id: r.id,
    apolloPersonId: r.apolloPersonId,
    rooftopId: r.rooftopId,
    matchMethod: r.matchMethod,
    matchConfidence: r.matchConfidence,
    enrichmentStatus: r.enrichmentStatus,
    lastSyncedAt: r.lastSyncedAt,
    priorityTier: (r.rooftopId ? (tiers.get(r.rooftopId) ?? 4) : 4) as EnrichmentPriorityTier,
  }));
}

/**
 * The cross-run spend guard: true when we already hold FRESH contact detail
 * bought for this person.
 *
 * Freshness matters. A profile whose Apollo sync is older than the staleness
 * window is allowed to be re-enriched — that is the same window the job uses to
 * decide a candidate is worth re-attempting, and gating on existence alone would
 * freeze every contact permanently at its first value. A profile carrying NO
 * email or phone (an Apollo miss recorded honestly) is not "already enriched";
 * the candidate's own staleness gate decides when to retry that.
 */
export async function isPersonAlreadyEnriched(
  apolloPersonId: string,
  deps?: Partial<OrchestrationDeps>,
): Promise<boolean> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();

  const profile = await prisma.dealerContactProfile.findUnique({
    where: { apolloPersonId },
    select: { email: true, phone: true, apolloLastSyncedAt: true },
  });
  if (!profile) return false;
  if (!profile.email && !profile.phone) return false;
  if (!profile.apolloLastSyncedAt) return true; // detail with no sync date — do not re-buy it
  return now.getTime() - profile.apolloLastSyncedAt.getTime() <= ENRICHMENT_STALENESS_DAYS * 86_400_000;
}

/** Apollo's own rendering of an unrevealed person: "John R." — never invented. */
function composeName(first: string | null, lastObfuscated: string | null): string | null {
  const parts = [first, lastObfuscated].filter((p): p is string => !!p && p.trim().length > 0);
  return parts.length ? parts.join(" ").trim() : null;
}

export type PersistContactInput = Parameters<EnrichmentDeps["persistContact"]>[0];

/**
 * Write a revealed contact onto the rooftop's DealerContactProfile.
 *
 * REUSE: the identity merge (dedup within the rooftop, never write a verified
 * email status down, never clobber a known name) is upsertContactProfile's, not
 * a second copy. This function adds only the Apollo provenance columns that
 * service does not own — apolloPersonId, the DNC verdict, the phone class.
 *
 * NEVER THROWS. runEnrichment does not guard this call, so an exception here
 * would escape the run loop and skip persistRun — leaving credits spent with no
 * audit row, the one outcome that must not happen. A failure is instead recorded
 * on the candidate's enrichmentError (which the job's success path does not
 * clear), so a lost write is visible in the database and not only in a log line.
 */
export async function persistApolloContact(
  input: PersistContactInput,
  deps?: Partial<OrchestrationDeps>,
): Promise<void> {
  const prisma = deps?.prisma ?? defaultPrisma;

  try {
    // The reveal result carries no name or title; the candidate row does. This
    // reads it rather than widening the job's persistContact contract.
    const candidate = await prisma.apolloPersonCandidate.findUnique({
      where: { apolloPersonId: input.apolloPersonId },
      select: {
        firstName: true,
        lastNameObfuscated: true,
        title: true,
        linkedinUrl: true,
        apolloOrganizationId: true,
      },
    });

    // apolloPersonId is @unique and is the spend idempotency key: when a profile
    // already carries it, that row IS this person and must be the one updated —
    // going through the rooftop dedup chain could land on a different row and
    // then collide on the unique index.
    //
    // A consequence worth naming: one Apollo person can surface under two
    // rooftops, and their single profile stays on the rooftop it was first filed
    // under. The alternative — moving it — would take the contact away from the
    // first rooftop's history to give it to the second, and would still leave one
    // of the two uncovered. This is the same reason the guard keys on the person
    // rather than the row: we pay for a person once.
    const owned = await prisma.dealerContactProfile.findUnique({
      where: { apolloPersonId: input.apolloPersonId },
      select: { id: true },
    });

    let profileId = owned?.id ?? null;

    if (!profileId) {
      const hasEmail = !!input.email;
      const upserted = await upsertContactProfile(
        input.rooftopId,
        {
          name: composeName(candidate?.firstName ?? null, candidate?.lastNameObfuscated ?? null),
          title: candidate?.title ?? null,
          email: input.email,
          phone: input.phone,
          // Same labels the contact backfill already writes for an Apollo
          // reveal, so the send-safe predicate reads one vocabulary.
          emailSource: hasEmail ? "apollo" : null,
          emailVerificationStatus: hasEmail ? "VERIFIED" : null,
          emailVerifiedAt: hasEmail ? input.apolloLastSyncedAt : null,
          contactSource: "apollo_people_search",
          contactConfidence: "high",
        },
        { prisma },
      );
      profileId = upserted?.id ?? null;
    }

    if (!profileId) {
      // No email, no phone, no name — an Apollo miss with nothing to file. The
      // candidate row already records UNREACHABLE; a nameless empty profile
      // would add nothing but a row.
      logger.info(
        `[apollo-orchestration] no identity key for person ${input.apolloPersonId} — no profile written`,
      );
      return;
    }

    // Claim the person only when the row is unclaimed or already ours; stealing
    // it from another person's profile would violate the unique index and lose
    // that person's spend guard.
    const target = await prisma.dealerContactProfile.findUnique({
      where: { id: profileId },
      select: { apolloPersonId: true },
    });
    const claimable = !target?.apolloPersonId || target.apolloPersonId === input.apolloPersonId;

    await prisma.dealerContactProfile.update({
      where: { id: profileId },
      data: {
        ...(claimable
          ? {
              apolloPersonId: input.apolloPersonId,
              apolloOrganizationId: candidate?.apolloOrganizationId ?? null,
              linkedinUrl: candidate?.linkedinUrl ?? null,
            }
          : {}),
        // Verbatim, per the phone-channel governance rules: only "not_found" is
        // a clearance, "pending" is not, and null means never checked.
        dncStatus: input.dncStatus,
        dncCheckedAt: input.dncCheckedAt,
        phoneType: input.phoneType,
        apolloLastSyncedAt: input.apolloLastSyncedAt,
      },
    });

    if (!claimable) {
      logger.warn(
        `[apollo-orchestration] profile ${profileId} is already claimed by another Apollo person — ` +
          `wrote the reveal but left the claim with ${target?.apolloPersonId}`,
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(
      `[apollo-orchestration] contact persist failed for person ${input.apolloPersonId} ` +
        `(rooftop ${input.rooftopId}) — the credit is already spent:`,
      err,
    );
    // Leave the failure where an operator will find it. The job's success path
    // sets enrichmentStatus but does not clear enrichmentError, so this survives.
    await prisma.apolloPersonCandidate
      .updateMany({
        where: { apolloPersonId: input.apolloPersonId },
        data: { enrichmentError: `contact persist failed: ${message}` },
      })
      .catch(() => {});
  }
}

/**
 * Record a candidate's enrichment outcome. Fields are mapped explicitly rather
 * than spread: the job passes a Record<string, unknown>, and handing an unknown
 * key to Prisma would throw out of the run loop.
 *
 * Never throws, for the same reason persistApolloContact does not.
 */
export async function updateEnrichmentCandidate(
  id: string,
  data: Record<string, unknown>,
  deps?: Partial<OrchestrationDeps>,
): Promise<void> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const mapped: {
    enrichmentStatus?: string;
    enrichmentError?: string | null;
    lastSyncedAt?: Date | null;
    revealPollCount?: number;
  } = {};

  if (typeof data.enrichmentStatus === "string") mapped.enrichmentStatus = data.enrichmentStatus;
  if ("enrichmentError" in data) {
    mapped.enrichmentError =
      data.enrichmentError == null ? null : String(data.enrichmentError).slice(0, 2_000);
  }
  if (data.lastSyncedAt instanceof Date) mapped.lastSyncedAt = data.lastSyncedAt;
  if (typeof data.revealPollCount === "number") mapped.revealPollCount = data.revealPollCount;

  try {
    await prisma.apolloPersonCandidate.update({ where: { id }, data: mapped });
  } catch (err) {
    logger.warn(`[apollo-orchestration] candidate ${id} status write failed:`, err);
  }
}

/**
 * Persist one enrichment run and return its id. This is the spend audit trail,
 * so it is written even for a preview and even for an aborted run — and its own
 * failure is swallowed rather than allowed to mask the run's real result.
 *
 * The id is returned so the route can report WHICH row records the spend; a
 * response that says "3 credits spent" without naming the row it came from is not
 * an audit trail anyone can follow. Returning a value is compatible with the
 * job's `persistRun: (run) => Promise<void>` contract.
 */
export async function persistEnrichmentRun(
  run: Record<string, unknown>,
  deps?: Partial<OrchestrationDeps>,
): Promise<string | null> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : 0);

  try {
    const created = await prisma.apolloEnrichmentRun.create({
      select: { id: true },
      data: {
        mode: typeof run.mode === "string" ? run.mode : "unknown",
        maxCredits: int(run.maxCredits),
        candidateCount: int(run.candidateCount),
        estimatedCost: int(run.estimatedCost),
        creditsSpent: int(run.creditsSpent),
        enrichedCount: int(run.enrichedCount),
        emptyCount: int(run.emptyCount),
        failedCount: int(run.failedCount),
        waterfallEnabled: run.waterfallEnabled === true,
        status: typeof run.status === "string" ? run.status : "RUNNING",
        abortReason: typeof run.abortReason === "string" ? run.abortReason : null,
        finishedAt: run.finishedAt instanceof Date ? run.finishedAt : null,
        startedBy: typeof run.startedBy === "string" ? run.startedBy : null,
      },
    });
    return created.id;
  } catch (err) {
    logger.error("[apollo-orchestration] enrichment run record failed to persist:", err);
    return null;
  }
}

/**
 * The paid reveal, over the EXISTING people/match adapter — the same
 * deterministic single-lead-credit call REVEAL_COST_CREDITS is defined against,
 * with its request shape untouched.
 *
 * Returns null when no client is configured, but the caller never gets that far:
 * buildRevealFn hands back undefined instead, so runEnrichment aborts before the
 * loop rather than counting a credit per candidate for calls never made.
 *
 * phone / dncStatus / phoneType are null because this call deliberately passes
 * reveal_phone_number:false (a phone reveal costs 8 credits). Reporting them as
 * null is accurate; the phone channel is simply not bought here.
 */
export function buildRevealFn(): EnrichmentDeps["reveal"] | undefined {
  const client = defaultApolloClient();
  if (!client) return undefined;
  return async (apolloPersonId: string): Promise<EnrichmentRevealResult | null> => {
    const revealed = await client.peopleMatch(apolloPersonId);
    if (!revealed) return null;
    return { email: revealed.email, phone: null, dncStatus: null, phoneType: null };
  };
}

/**
 * Build the real dependencies, capturing the id of the run row that persistRun
 * writes so the caller can report it.
 *
 * consumer is "backfill", never "live": bulk admin enrichment is exactly the
 * demand the reserve floor exists to hold budget back FROM, so it must draw only
 * against what is left above the live reserve.
 */
function enrichmentDeps(deps: Partial<OrchestrationDeps> | undefined, capture: { runId: string | null }) {
  return {
    prisma: deps?.prisma ?? defaultPrisma,
    ...(deps?.now ? { now: deps.now } : {}),
    selectCandidates: () => selectEnrichmentCandidates(deps),
    isPersonAlreadyEnriched: (personId: string) => isPersonAlreadyEnriched(personId, deps),
    persistContact: (contact: PersistContactInput) => persistApolloContact(contact, deps),
    updateCandidate: (id: string, data: Record<string, unknown>) =>
      updateEnrichmentCandidate(id, data, deps),
    persistRun: async (run: Record<string, unknown>) => {
      capture.runId = await persistEnrichmentRun(run, deps);
    },
  } satisfies Partial<EnrichmentDeps>;
}

export interface EnrichmentRequest {
  maxCredits?: number;
  startedBy?: string;
}

/** The id of the ApolloEnrichmentRun row this call wrote, when it wrote one. */
export type WithRunId<T> = T & { runId: string | null };

/**
 * Report what an enrichment run WOULD cost. Spends nothing, calls no billable
 * endpoint, and does not require the enrichment flag — the owner has to be able
 * to see the number before deciding whether to turn spending on.
 */
export async function previewApolloEnrichment(
  input: EnrichmentRequest,
  deps?: Partial<OrchestrationDeps>,
): Promise<WithRunId<EnrichmentPreview>> {
  const capture = { runId: null as string | null };
  const preview = await previewEnrichment(
    // includeWeakMatches is never set: a low-confidence or freshly-created link
    // buys a contact filed under the wrong dealership.
    { maxCredits: input.maxCredits, startedBy: input.startedBy, consumer: "backfill" },
    enrichmentDeps(deps, capture),
  );
  return { ...preview, runId: capture.runId };
}

/**
 * Execute a capped enrichment run. The only operation in this module that can
 * spend, and it stays inert until the owner sets both APOLLO_ENRICHMENT_ENABLED
 * (checked by the job) and APOLLO_REVEAL_ENABLED (which is what makes a client —
 * and therefore a reveal implementation — exist at all).
 */
export async function executeApolloEnrichment(
  input: EnrichmentRequest,
  deps?: Partial<OrchestrationDeps>,
): Promise<WithRunId<EnrichmentRunResult>> {
  const capture = { runId: null as string | null };
  const run = await runEnrichment(
    { maxCredits: input.maxCredits, startedBy: input.startedBy, consumer: "backfill" },
    { ...enrichmentDeps(deps, capture), reveal: buildRevealFn() },
  );
  return { ...run, runId: capture.runId };
}

// ─── ops counters ───────────────────────────────────────────────────────────

export interface ApolloPipelineCounters {
  searchEnabled: boolean;
  enrichmentEnabled: boolean;
  waterfallEnabled: boolean;
  candidates: {
    total: number;
    withRooftop: number;
    /** High/medium confidence link to an existing rooftop — the spendable pool. */
    strongMatch: number;
    /** Never resolved to a rooftop yet. */
    unresolved: number;
    byStatus: Record<string, number>;
    byConfidence: Record<string, number>;
  };
  search: { latestRunKey: string | null; latestRunAt: Date | null };
  enrichment: {
    runs: number;
    creditsSpentAllRuns: number;
    contactsFromApolloPeople: number;
    lastRun: {
      mode: string;
      status: string;
      creditsSpent: number;
      enrichedCount: number;
      startedAt: Date;
      abortReason: string | null;
    } | null;
  };
}

/** The same rule as isStrongLink, expressed for the database. */
const strongMatchWhere = () => ({
  rooftopId: { not: null } as const,
  matchMethod: { notIn: [...WEAK_MATCH_METHODS] },
  matchConfidence: { in: [...STRONG_MATCH_CONFIDENCES] },
});

/**
 * Read-only census of the People Search → match → enrichment pipeline. Counts
 * only: no Apollo call, no write, no spend. Errors propagate so the admin surface
 * shows a real failure instead of fabricated zeros.
 */
export async function getApolloPipelineCounters(
  deps?: Partial<OrchestrationDeps>,
): Promise<ApolloPipelineCounters> {
  const prisma = deps?.prisma ?? defaultPrisma;

  const [
    total,
    withRooftop,
    strongMatch,
    statusGroups,
    confidenceGroups,
    latest,
    runs,
    creditsAgg,
    apolloContacts,
    lastRun,
  ] = await Promise.all([
    prisma.apolloPersonCandidate.count(),
    prisma.apolloPersonCandidate.count({ where: { rooftopId: { not: null } } }),
    prisma.apolloPersonCandidate.count({ where: strongMatchWhere() }),
    prisma.apolloPersonCandidate.groupBy({ by: ["enrichmentStatus"], _count: { _all: true } }),
    prisma.apolloPersonCandidate.groupBy({ by: ["matchConfidence"], _count: { _all: true } }),
    prisma.apolloPersonCandidate.findFirst({
      orderBy: { createdAt: "desc" },
      select: { searchRunKey: true, createdAt: true },
    }),
    prisma.apolloEnrichmentRun.count(),
    prisma.apolloEnrichmentRun.aggregate({ _sum: { creditsSpent: true } }),
    prisma.dealerContactProfile.count({ where: { apolloPersonId: { not: null } } }),
    prisma.apolloEnrichmentRun.findFirst({
      orderBy: { startedAt: "desc" },
      select: {
        mode: true,
        status: true,
        creditsSpent: true,
        enrichedCount: true,
        startedAt: true,
        abortReason: true,
      },
    }),
  ]);

  const byStatus: Record<string, number> = {};
  for (const g of statusGroups as Array<{ enrichmentStatus: string; _count: { _all: number } }>) {
    byStatus[g.enrichmentStatus] = g._count._all;
  }
  const byConfidence: Record<string, number> = {};
  for (const g of confidenceGroups as Array<{ matchConfidence: string | null; _count: { _all: number } }>) {
    // A null confidence means the match pass has not reached it yet — reported
    // as "unmatched" rather than folded into "low", which is a real verdict.
    byConfidence[g.matchConfidence ?? "unmatched"] = g._count._all;
  }

  return {
    searchEnabled: apolloPeopleSearchEnabled(),
    enrichmentEnabled: enrichmentEnabled(),
    waterfallEnabled: waterfallEnabled(),
    candidates: {
      total,
      withRooftop,
      strongMatch,
      unresolved: total - withRooftop,
      byStatus,
      byConfidence,
    },
    search: { latestRunKey: latest?.searchRunKey ?? null, latestRunAt: latest?.createdAt ?? null },
    enrichment: {
      runs,
      creditsSpentAllRuns: creditsAgg._sum.creditsSpent ?? 0,
      contactsFromApolloPeople: apolloContacts,
      lastRun: lastRun ?? null,
    },
  };
}
