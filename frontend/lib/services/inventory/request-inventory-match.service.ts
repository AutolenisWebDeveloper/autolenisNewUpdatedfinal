// lib/services/inventory/request-inventory-match.service.ts — Batch 1
//
// Canonical request → inventory matching. Given an eligible VehicleRequest it
// finds executable dealer supply that satisfies the request, scores each match
// deterministically, and persists the result set into VehicleRequestMatchResult
// — the artifact downstream sourcing (Batch 3) will consume.
//
// Truthfulness contract:
//   - ZERO MATCHES is a legitimate business result, NOT an execution failure.
//   - "no executable supply at all" (NO_ELIGIBLE_SUPPLY) is distinct from
//     "supply exists but none fits this request" (ZERO_MATCHES).
//   - An execution failure (DB error) THROWS — it never masquerades as zero matches.
//   - Re-running for the same request is idempotent (upsert on the unique
//     [requestId, inventoryItemId]) and concurrency-safe.

import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { executableSupplyWhere } from "./inventory-eligibility";
import { computeMatchScore, type MatchCriteria } from "./inventory-match-score";
import type { Prisma } from "@prisma/client";

export type RequestMatchOutcome =
  | "MATCHED"
  | "ZERO_MATCHES"
  | "NO_ELIGIBLE_SUPPLY"
  | "SKIPPED_TERMINAL";

export interface RequestMatchResult {
  requestId: string;
  outcome: RequestMatchOutcome;
  eligibleSupply: number; // total executable supply in the platform right now
  candidates: number; // executable supply that also satisfies the request criteria
  persisted: number; // rows written to VehicleRequestMatchResult
}

// Requests in a terminal/closed state are not matched.
const TERMINAL_STATUSES = new Set([
  "OFFER_ACCEPTED",
  "DEAL_CREATED",
  "CLOSED_NO_MATCH",
  "CANCELLED",
  "EXPIRED",
]);

const MAX_RESULTS = 25;
const CANDIDATE_SCAN_CAP = 250;

function criteriaFromRequest(req: {
  makePreference: string | null;
  modelPreference: string | null;
  yearMin: number | null;
  yearMax: number | null;
  maxBudgetCents: number | null;
}): MatchCriteria {
  return {
    make: req.makePreference,
    model: req.modelPreference,
    yearMin: req.yearMin,
    yearMax: req.yearMax,
    maxPriceCents: req.maxBudgetCents,
  };
}

function criteriaWhere(c: MatchCriteria): Prisma.InventoryItemWhereInput {
  const clauses: Prisma.InventoryItemWhereInput[] = [];
  if (c.make) clauses.push({ make: { equals: c.make, mode: "insensitive" } });
  if (c.model) clauses.push({ model: { contains: c.model, mode: "insensitive" } });
  if (c.yearMin != null || c.yearMax != null) {
    clauses.push({ year: { ...(c.yearMin != null ? { gte: c.yearMin } : {}), ...(c.yearMax != null ? { lte: c.yearMax } : {}) } });
  }
  if (c.maxPriceCents != null && c.maxPriceCents > 0) clauses.push({ priceCents: { lte: c.maxPriceCents } });
  return clauses.length ? { AND: clauses } : {};
}

/**
 * Match one request against executable supply and persist the canonical results.
 * @param now injectable clock for deterministic tests.
 */
export async function matchInventoryForRequest(requestId: string, now: Date = new Date()): Promise<RequestMatchResult> {
  const request = await prisma.vehicleRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, status: true,
      makePreference: true, modelPreference: true,
      yearMin: true, yearMax: true, maxBudgetCents: true,
    },
  });
  if (!request) throw new Error(`matchInventoryForRequest: request ${requestId} not found`);

  if (TERMINAL_STATUSES.has(String(request.status))) {
    return { requestId, outcome: "SKIPPED_TERMINAL", eligibleSupply: 0, candidates: 0, persisted: 0 };
  }

  const eligibleBase = executableSupplyWhere(now);
  const criteria = criteriaFromRequest(request);

  // Distinguish "no executable supply at all" from "supply exists but none fits".
  const eligibleSupply = await prisma.inventoryItem.count({ where: eligibleBase });
  if (eligibleSupply === 0) {
    await replaceResults(requestId, []);
    return { requestId, outcome: "NO_ELIGIBLE_SUPPLY", eligibleSupply: 0, candidates: 0, persisted: 0 };
  }

  const candidateItems = await prisma.inventoryItem.findMany({
    where: { AND: [eligibleBase, criteriaWhere(criteria)] },
    take: CANDIDATE_SCAN_CAP,
    select: { id: true, make: true, model: true, year: true, priceCents: true, lane: true },
  });

  if (candidateItems.length === 0) {
    await replaceResults(requestId, []);
    return { requestId, outcome: "ZERO_MATCHES", eligibleSupply, candidates: 0, persisted: 0 };
  }

  // Score, then rank deterministically: score desc, then id asc as a stable tiebreak.
  const scored = candidateItems
    .map((item) => ({ item, scored: computeMatchScore(criteria, item) }))
    .sort((a, b) => (b.scored.score - a.scored.score) || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0))
    .slice(0, MAX_RESULTS);

  const rows = scored.map(({ item, scored: s }) => ({
    inventoryItemId: item.id,
    matchScore: s.score,
    source: String(item.lane),
    priceCents: item.priceCents,
    notes: `make=${s.factors.make} model=${s.factors.model} year=${s.factors.year} price=${s.factors.price} lane=${s.factors.lane}`,
  }));

  await replaceResults(requestId, rows);

  return { requestId, outcome: "MATCHED", eligibleSupply, candidates: candidateItems.length, persisted: rows.length };
}

interface MatchRow {
  inventoryItemId: string;
  matchScore: number;
  source: string;
  priceCents: number;
  notes: string;
}

/**
 * Idempotently replace the persisted match set for a request. Upsert on the
 * unique [requestId, inventoryItemId] (never duplicates under concurrency), then
 * remove any prior rows no longer matched. Runs in one transaction.
 */
async function replaceResults(requestId: string, rows: MatchRow[]): Promise<void> {
  const matchedIds = rows.map((r) => r.inventoryItemId);
  const ops: Prisma.PrismaPromise<unknown>[] = rows.map((r) =>
    prisma.vehicleRequestMatchResult.upsert({
      where: { requestId_inventoryItemId: { requestId, inventoryItemId: r.inventoryItemId } },
      create: { requestId, inventoryItemId: r.inventoryItemId, matchScore: r.matchScore, source: r.source, priceCents: r.priceCents, notes: r.notes },
      update: { matchScore: r.matchScore, source: r.source, priceCents: r.priceCents, notes: r.notes },
    })
  );
  ops.push(
    matchedIds.length > 0
      ? prisma.vehicleRequestMatchResult.deleteMany({ where: { requestId, inventoryItemId: { notIn: matchedIds } } })
      : prisma.vehicleRequestMatchResult.deleteMany({ where: { requestId } })
  );
  await prisma.$transaction(ops);
}

/**
 * Batch entry point for the refresh cron: match every non-terminal request and
 * return a truthful roll-up. A single request's execution failure is isolated and
 * surfaced as `failed`, never swallowed into a zero-match count.
 */
export async function refreshMatchesForActiveRequests(now: Date = new Date()): Promise<{
  processed: number;
  matched: number;
  zeroMatches: number;
  noSupply: number;
  skipped: number;
  failed: number;
}> {
  const requests = await prisma.vehicleRequest.findMany({
    where: { status: { in: ["SUBMITTED", "INTAKE", "ACTIVE_SOURCING", "OFFER_READY"] } },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 500,
  });

  let matched = 0, zeroMatches = 0, noSupply = 0, skipped = 0, failed = 0;
  for (const r of requests) {
    try {
      const res = await matchInventoryForRequest(r.id, now);
      if (res.outcome === "MATCHED") matched++;
      else if (res.outcome === "ZERO_MATCHES") zeroMatches++;
      else if (res.outcome === "NO_ELIGIBLE_SUPPLY") noSupply++;
      else skipped++;
    } catch (e) {
      failed++;
      logger.error(`[request-match] failed for request ${r.id}:`, e);
    }
  }
  return { processed: requests.length, matched, zeroMatches, noSupply, skipped, failed };
}
