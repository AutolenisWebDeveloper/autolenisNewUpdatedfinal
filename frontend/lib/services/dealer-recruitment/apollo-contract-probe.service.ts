// Apollo API-contract probe — a one-shot, hard-capped live check of the two
// endpoints the reveal path depends on.
//
// WHY THIS EXISTS. CI egress to api.apollo.io is blocked and there is no staging
// tenant, so nothing in the test matrix can prove what Apollo actually answers.
// The reveal adapter has been running against an undocumented endpoint for two
// billing cycles with 500/500 misses — including 39 rooftops with real, working
// domains — and the only way to establish the corrected contract is to make
// the corrected calls and look at the raw envelopes. This module does exactly
// that, for a fixed list of rooftops, and nothing else.
//
// WHAT IT NEVER DOES. It never reaches people/match (the reveal), never
// paginates, never takes a caller-supplied rooftop or domain, and never runs
// more than one organization resolution and one people search per rooftop. The
// rooftop list is a constant. The spend ceiling is therefore a constant too:
// PROBE_MAX_CREDITS.
//
// IT SPENDS, AND IT SAYS SO. Organization Enrichment bills 1 credit on a hit
// ("0 credits if not found"), so each resolution draws ORG_RESOLVE_COST_CREDITS
// from the ledger BEFORE the call — the same atomic draw the reveal uses, as
// consumer "backfill" so it can never touch the live reserve — and refunds it
// only on the documented free outcome (a clean 2xx with no organization). A
// non-2xx or transport failure keeps the credit: whether Apollo charged is
// unknowable, and undercounting is the failure that overruns a cap. The people
// search is not on Apollo's list of credit-consuming endpoints and draws nothing.
//
// The raw status and envelope of every call are returned verbatim (bounded in
// size), because the point is to SEE what Apollo sent, not what a parser made of
// it. The response is admin-only and may carry masked person names and titles.

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { drawCredits, refundCredits, cycleKeyFor, daysInCycleFor } from "./apollo-credit-ledger.service";
import {
  apolloRequest,
  apolloEnabled,
  APOLLO_SALES_TITLES,
  ORG_RESOLVE_COST_CREDITS,
  type ApolloHttpResult,
  type ApolloRequestInput,
} from "./apollo.service";

/**
 * Three rooftops with real, working domains that production has recorded as
 * empty_stage="no_org" on every attempt. Fixed here, not accepted from the
 * request, so the probe's spend ceiling is a constant an admin can read before
 * running it.
 */
export const PROBE_ROOFTOPS = [
  { name: "Berman Chrysler Dodge Jeep Ram", domain: "bermancdjr.com" },
  { name: "Marino Chrysler Dodge Jeep Ram", domain: "marinocdjr.com" },
  { name: "Jack Phelan Chrysler Dodge Jeep Ram", domain: "jackphelancdjr.com" },
] as const;

/** The most a run can bill: one organization resolution per rooftop. */
export const PROBE_MAX_CREDITS = PROBE_ROOFTOPS.length * ORG_RESOLVE_COST_CREDITS;

/** Raw envelopes are returned whole up to this many JSON characters, then truncated. */
export const PROBE_BODY_LIMIT = 16_000;

export const PROBE_ORG_ENDPOINT = "/organizations/enrich";
export const PROBE_PEOPLE_ENDPOINT = "/mixed_people/api_search";

export interface ProbeCall {
  endpoint: string;
  method: "GET" | "POST";
  /** What was sent, minus the API key. */
  request: { query?: Record<string, unknown>; body?: Record<string, unknown> };
  /** HTTP status, or null when the request never received one. */
  status: number | null;
  ok: boolean | null;
  /** Set when the call failed before an HTTP answer. */
  transport: string | null;
  /** Top-level keys of the envelope — readable even when the body is truncated. */
  envelopeKeys: string[];
  /** The parsed envelope, or a truncated JSON string when it exceeds PROBE_BODY_LIMIT. */
  body: unknown;
  truncated: boolean;
}

export interface ProbeSkip {
  skipped: string;
}

export interface ProbeRooftopResult {
  name: string;
  domain: string;
  /** The dealer_rooftops row with this website_host, when one exists (read-only). */
  rooftopId: string | null;
  creditsDrawn: number;
  /** What the ledger keeps after settlement — 0 on a documented free miss. */
  creditsKept: number;
  orgResolution: ProbeCall | ProbeSkip;
  organizationId: string | null;
  peopleSearch: ProbeCall | ProbeSkip;
}

export interface ProbeResult {
  ranAt: Date;
  cycleKey: string;
  consumer: "backfill";
  maxCredits: number;
  creditsDrawn: number;
  creditsKept: number;
  /** Every Apollo path the run touched — the assertion that people/match is absent lives on this. */
  endpointsTouched: string[];
  rooftops: ProbeRooftopResult[];
}

export interface ProbeDeps {
  prisma: PrismaClient;
  now: Date;
  enabled: () => boolean;
  request: typeof apolloRequest;
}

function envelopeKeys(json: unknown): string[] {
  return json && typeof json === "object" && !Array.isArray(json) ? Object.keys(json as object) : [];
}

function bound(json: unknown): { body: unknown; truncated: boolean } {
  if (json === null || json === undefined) return { body: json ?? null, truncated: false };
  let str: string;
  try {
    str = JSON.stringify(json);
  } catch {
    return { body: String(json), truncated: false };
  }
  if (str.length <= PROBE_BODY_LIMIT) return { body: json, truncated: false };
  return { body: str.slice(0, PROBE_BODY_LIMIT), truncated: true };
}

function record(endpoint: string, input: ApolloRequestInput, r: ApolloHttpResult): ProbeCall {
  const request: ProbeCall["request"] = {};
  if (input.query) request.query = { ...input.query };
  if (input.body) request.body = { ...input.body };
  if (r.kind === "http") {
    const { body, truncated } = bound(r.json);
    return { endpoint, method: input.method, request, status: r.status, ok: r.ok, transport: null, envelopeKeys: envelopeKeys(r.json), body, truncated };
  }
  return {
    endpoint,
    method: input.method,
    request,
    status: null,
    ok: null,
    transport: r.kind === "transport" ? r.error : "no API key — nothing was sent",
    envelopeKeys: [],
    body: null,
    truncated: false,
  };
}

/**
 * Run the probe. Returns null when the paid tier is off — the organization
 * resolution bills, so the probe honours the same gate the reveal does.
 */
export async function runApolloContractProbe(deps?: Partial<ProbeDeps>): Promise<ProbeResult | null> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const now = deps?.now ?? new Date();
  const enabled = deps?.enabled ?? apolloEnabled;
  const request = deps?.request ?? apolloRequest;

  if (!enabled()) return null;

  const cycleKey = cycleKeyFor(now);
  const day = now.getUTCDate();
  const daysInCycle = daysInCycleFor(now);
  const touched = new Set<string>();
  const rooftops: ProbeRooftopResult[] = [];
  let creditsDrawn = 0;
  let creditsKept = 0;

  for (const target of PROBE_ROOFTOPS) {
    // Read-only correlation to the production row; fail open — the probe is
    // about Apollo's contract, not ours.
    const rooftopId = await prisma.dealerRooftop
      .findUnique({ where: { websiteHost: target.domain }, select: { id: true } })
      .then((r) => r?.id ?? null)
      .catch(() => null);

    const result: ProbeRooftopResult = {
      name: target.name,
      domain: target.domain,
      rooftopId,
      creditsDrawn: 0,
      creditsKept: 0,
      orgResolution: { skipped: "not attempted" },
      organizationId: null,
      peopleSearch: { skipped: "not attempted" },
    };
    rooftops.push(result);

    // 1. Draw BEFORE the paid call. No budget → this rooftop is skipped entirely;
    // a probe must never be the thing that spends the last of the live reserve.
    const draw = await drawCredits(
      { cycleKey, cost: ORG_RESOLVE_COST_CREDITS, consumer: "backfill", day, daysInCycle },
      { prisma },
    );
    if (!draw.drawn) {
      result.orgResolution = { skipped: `no budget (${draw.reason ?? "unknown"})` };
      result.peopleSearch = { skipped: "no organization resolution" };
      continue;
    }
    result.creditsDrawn = ORG_RESOLVE_COST_CREDITS;
    creditsDrawn += ORG_RESOLVE_COST_CREDITS;

    // 2. Organization Enrichment by domain — exactly the stage-1 call the reveal
    // makes for a hosted rooftop, on the same transport.
    const orgInput: ApolloRequestInput = { method: "GET", query: { domain: target.domain } };
    const orgRes = await request(PROBE_ORG_ENDPOINT, orgInput);
    touched.add(PROBE_ORG_ENDPOINT);
    result.orgResolution = record(PROBE_ORG_ENDPOINT, orgInput, orgRes);

    const organizationId =
      orgRes.kind === "http" && orgRes.ok
        ? ((orgRes.json as { organization?: { id?: string | null } | null } | null)?.organization?.id ?? null)
        : null;
    result.organizationId = organizationId;

    // 3. Settle the draw. Documented free outcome: a clean 2xx that found
    // nothing. Everything else — a hit, a non-2xx, a transport failure, a key
    // that vanished mid-run — keeps the credit.
    const documentedFreeMiss = orgRes.kind === "http" && orgRes.ok && !organizationId;
    const nothingSent = orgRes.kind === "no_key";
    if (documentedFreeMiss || nothingSent) {
      await refundCredits(cycleKey, ORG_RESOLVE_COST_CREDITS, { prisma });
    } else {
      result.creditsKept = ORG_RESOLVE_COST_CREDITS;
      creditsKept += ORG_RESOLVE_COST_CREDITS;
    }

    if (!organizationId) {
      result.peopleSearch = { skipped: "no organization id resolved" };
      continue;
    }

    // 4. People API Search by organization id — the stage-2 call, free, small
    // page so the raw envelope stays readable.
    const peopleInput: ApolloRequestInput = {
      method: "POST",
      body: {
        organization_ids: [organizationId],
        person_titles: [...APOLLO_SALES_TITLES],
        include_similar_titles: true,
        page: 1,
        per_page: 3,
      },
    };
    const peopleRes = await request(PROBE_PEOPLE_ENDPOINT, peopleInput);
    touched.add(PROBE_PEOPLE_ENDPOINT);
    result.peopleSearch = record(PROBE_PEOPLE_ENDPOINT, peopleInput, peopleRes);
  }

  logger.info(
    `[apollo-probe] cycle=${cycleKey} rooftops=${rooftops.length} drawn=${creditsDrawn} kept=${creditsKept} ` +
      `endpoints=${[...touched].join(",")}`,
  );

  return {
    ranAt: now,
    cycleKey,
    consumer: "backfill",
    maxCredits: PROBE_MAX_CREDITS,
    creditsDrawn,
    creditsKept,
    endpointsTouched: [...touched].sort(),
    rooftops,
  };
}
