// MarketCheck adapter — production inventory aggregator.
// Activates when MARKETCHECK_API_KEY is set. Skips gracefully otherwise.
//
// API: https://www.marketcheck.com/automotive-api/
// Endpoint: GET /v2/search/car/active?api_key=...&zip=...&radius=...&rows=...&start=...
//
// FREE-TIER LIMITS this file is built around:
//   500 API calls/month · 5 calls/second · 100 mile radius ceiling ·
//   `rows` maxes at 50 · `start + rows` may not exceed 500 ·
//   `start` past num_found returns HTTP 422.
//
// WHY THIS FILE PAGINATES. It used to make exactly one fetch with no `start`, so a "full"
// sweep saw at most 50 listings. Meanwhile two crons called it 28 times a day — ~850
// calls/month against a 500 cap — which produced 191 consecutive runs answered
// "HTTP 429: Too Many Requests" (2026-08-24 .. 2026-08-31) behind a silently frozen
// catalogue. One daily walk of <= 10 pages sees 10x more of the market for a third of the
// spend.
//
// WHY THE LOOP LIVES HERE AND NOT IN THE ORCHESTRATOR. orchestrator.ts writes one
// InventorySyncRun per AdapterRunResult and computeHealthScore divides by result count.
// Paginating by calling search() ten times would write ten sync-run rows per sweep and turn
// "1 bad page in 10" into "90% healthy".
//
// WHY THERE IS NO FALLBACK ZIP. `zip: params.zip ?? "10001"` used to live here, and because
// both crons passed an empty params object it ALWAYS won — every ingested row in production
// carries external_dealer_state='NY'. Geography is now config; an unconfigured source makes
// zero calls and says NOT_CONFIGURED.

import { logger } from "@/lib/logger";
import type {
  IInventoryAdapter, NormalizedVehicle, AdapterRunResult, AdapterOutcome, SearchParams, StopReason,
} from "./IInventoryAdapter";
import { buildSourceKey } from "./IInventoryAdapter";
import {
  MAX_RADIUS_MILES, MAX_ROWS_PER_CALL, MAX_CALLS_PER_SWEEP,
  PROVIDER_PAGINATION_LIMIT, DEFAULT_RADIUS_MILES,
} from "../inventory-source-config.service";
import {
  classifyYield,
  newDropTally,
  recordDrop,
  type NormalizeDropTally,
} from "../sync-yield";

/** 250ms between calls = 4 req/s, under the 5 req/s free-tier limit. */
const MIN_INTER_CALL_MS = 250;
/** Per-call timeout. Lower than the old 20s because a sweep now makes up to 10 calls. */
const PER_CALL_TIMEOUT_MS = 12_000;
/** Wall-clock stop for the whole walk, well inside the route's maxDuration of 300s. */
const SWEEP_DEADLINE_MS = 90_000;

/**
 * The provider's dealership facts. `dealer` and `mc_dealership` are SIBLINGS on the listing
 * root and both are optional; neither implies the other, so every read is independent.
 * Overlapping fields carry the same values on every listing observed, so the merge below
 * prefers `dealer` and falls back to `mc_dealership` rather than choosing one object.
 */
interface MarketCheckDealer {
  /** EQUALS `mc_dealership.mc_website_id`. It is NOT the dealer id — see normalize(). */
  id?: number | string;
  /** The rooftop graph's strongest key: `DealerRooftop.websiteHost` is @unique. */
  website?: string;
  name?: string;
  phone?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  latitude?: number | string;
  longitude?: number | string;
  seller_email?: string;
  dealer_type?: string;
  dealership_group_name?: string;
  msa_code?: string;
}

/**
 * The MarketCheck-side identity of the selling rooftop. Requested with
 * `include_mc_dealership_object=true`; absent entirely without it.
 *
 * THIS IS WHERE THE IDENTIFIERS LIVE. The adapter used to read `mc_rooftop_id` and
 * `mc_dealer_id` off `dealer`, where they do not exist (0/15 in the §9 probe, 0/3 in the
 * 2026-09-10 re-probe), so `mcRooftopId` was always undefined and `mcDealerId` fell back to
 * `dealer.id` — the WEBSITE id, a different space. The hierarchy runs
 * website -> dealer -> location -> rooftop -> group, and only `mc_rooftop_id` is the
 * rooftop-level join key §22a's "every listing carries its dealer" depends on.
 */
interface MarketCheckDealership {
  mc_website_id?: number | string;
  mc_dealer_id?: number | string;
  mc_location_id?: number | string;
  mc_rooftop_id?: number | string;
  mc_dealership_group_id?: number | string;
  mc_dealership_group_name?: string;
  /** "Dealer" | "Retailer" | "Dealership Group" | "Aggregator" | "Marketing" | "Financing". */
  mc_category?: string;
  website?: string;
  name?: string;
  dealer_type?: string;
  street?: string;
  city?: string;
  state?: string;
  country?: string;
  zip?: string;
  latitude?: number | string;
  longitude?: number | string;
  phone?: string;
  msa_code?: string;
}

interface MarketCheckListing {
  /** `<VIN>-<hex8>-<hex4>`; changes when price or miles change, so it is a listing-VERSION key. */
  id?: string;
  vin?: string;
  /** Distance in miles from the query centre. Now a REJECTION criterion, not just evidence. */
  dist?: number;
  build?: {
    year?: number;
    make?: string;
    model?: string;
    trim?: string;
    body_type?: string;
    engine?: string;
    transmission?: string;
    drivetrain?: string;
    fuel_type?: string;
  };
  miles?: number;
  price?: number;
  msrp?: number;
  exterior_color?: string;
  interior_color?: string;
  media?: { photo_links?: string[] };
  vdp_url?: string;
  /** When the PROVIDER last saw the listing. Distinct from our own sweep clock. */
  last_seen_at?: number;
  last_seen_at_date?: string;
  /** Days active at the CURRENT dealer — the provider's own default staleness metric. */
  dos_active?: number;
  dealer?: MarketCheckDealer;
  mc_dealership?: MarketCheckDealership;
  // DELIBERATELY NOT DECLARED: carfax_1_owner and carfax_clean_title. They arrive on every
  // listing unrequested, and MarketCheck's own contract says to treat them as if they did not
  // exist. §8a makes the vehicle history report dealer-supplied. Declaring them here is the
  // first step to reading them, so the type stops at the boundary and
  // __tests__/no-carfax-from-provider.test.ts fails the build if anything reaches past it.
}

interface MarketCheckResponse {
  num_found?: number;
  listings?: MarketCheckListing[];
}

interface PageResult {
  ok: boolean;
  status: number;
  transient: boolean;
  listings: MarketCheckListing[];
  numFound: number | null;
  /** The provider's own message on a non-2xx. The ONLY thing that classifies a 422. */
  message?: string;
  /** What a 429 told us about coming back. Advisory; nothing branches on its absence. */
  throttle?: ThrottleSignal;
}

/**
 * What the provider said about rate limiting.
 *
 * THE HEADER NAMES ARE UNVERIFIED against the production plan. The investigation transport
 * does not expose HTTP headers and this session must not make a raw keyed call, so the read
 * is deliberately tolerant — case-insensitive, absence-tolerant, several spellings — and
 * purely advisory. `observed` exists so "the provider said nothing" and "we did not look"
 * stay distinguishable in a run record, which is the distinction the 191-run silent freeze
 * did not have.
 */
export interface ThrottleSignal {
  observed: boolean;
  retryAfterSeconds?: number;
  quotaRemaining?: number;
  quotaLimit?: number;
  rateLimitRemaining?: number;
}

/** How a 422 was understood. The provider uses one status code for three unrelated answers. */
type Refusal422 = "PAGINATION_CEILING" | "RADIUS_REFUSED" | "INVALID_QUERY" | "UNKNOWN";

/**
 * Classify a 422 by its message.
 *
 * Observed live 2026-09-10 against /v2/search/car/active:
 *   "Subscribed package pagination limit of 500 rows exceeded"  -> the plan's deep-paging cap
 *   "Subscribed package radius limit of 100 miles exceeded"     -> OUR radius exceeds the plan
 *   "Zipcode 00000 not found"                                   -> invalid input
 *
 * UNKNOWN is the safe default and is treated as a provider ERROR, never as exhaustion. The
 * retired behaviour mapped every 422 to "collected everything the provider said existed",
 * so a bad ZIP and a misconfigured radius both rendered as a clean, empty, successful
 * market — the exact thing §22a L1079 forbids.
 */
function classify422(message: string | undefined): Refusal422 {
  const m = (message ?? "").toLowerCase();
  if (!m) return "UNKNOWN";
  if (m.includes("pagination limit")) return "PAGINATION_CEILING";
  if (m.includes("radius limit")) return "RADIUS_REFUSED";
  if (m.includes("not found") || m.includes("invalid")) return "INVALID_QUERY";
  return "UNKNOWN";
}

/** The provider's message, from a JSON body or a plain-text one. Never throws. */
function messageOf(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown; error?: unknown };
    const m = parsed.message ?? parsed.error;
    if (typeof m === "string" && m.trim()) return m.trim();
  } catch {
    // Not JSON. An HTML error page from a gateway is not a message, so cap the length
    // rather than pasting a document into a run record.
  }
  return trimmed.slice(0, 300);
}

/** RFC 9110 allows delta-seconds OR an HTTP-date. Which this provider sends is UNVERIFIED. */
function retryAfterSeconds(value: string | null): number | undefined {
  if (!value) return undefined;
  const secs = Number(value.trim());
  if (Number.isFinite(secs) && secs >= 0) return Math.round(secs);
  const at = Date.parse(value);
  if (Number.isFinite(at)) return Math.max(0, Math.round((at - Date.now()) / 1000));
  return undefined;
}

/** First header present from a list of candidate spellings. Headers lookup is case-insensitive. */
function firstHeader(h: Headers, names: readonly string[]): string | null {
  for (const n of names) {
    const v = h.get(n);
    if (v !== null) return v;
  }
  return null;
}

function readThrottle(h: Headers): ThrottleSignal {
  const num = (v: string | null): number | undefined => {
    if (v === null) return undefined;
    const n = Number(v.trim());
    return Number.isFinite(n) ? n : undefined;
  };
  const retry = retryAfterSeconds(h.get("retry-after"));
  const quotaRemaining = num(firstHeader(h, ["quota-remaining", "x-quota-remaining"]));
  const quotaLimit = num(firstHeader(h, ["quota-limit", "x-quota-limit"]));
  const rateLimitRemaining = num(firstHeader(h, ["ratelimit-remaining", "x-ratelimit-remaining"]));
  return {
    observed:
      retry !== undefined ||
      quotaRemaining !== undefined ||
      quotaLimit !== undefined ||
      rateLimitRemaining !== undefined,
    retryAfterSeconds: retry,
    quotaRemaining,
    quotaLimit,
    rateLimitRemaining,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A non-blank trimmed string, or undefined. Never writes "" into a nullable column. */
function text(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * A usable coordinate pair, or undefined for BOTH.
 *
 * Rejected: non-numeric values (a NaN in a Decimal column is a write error, not a location),
 * out-of-range values, and exactly 0,0 — Null Island is the provider's missing-coordinate
 * sentinel, and storing it would place a Texas dealership in the Gulf of Guinea and make every
 * distance calculation silently wrong rather than absent. Returned as a pair because half a
 * coordinate is not a location.
 */
function coordinates(lat: unknown, lng: unknown): { lat: number; lng: number } | undefined {
  const n = (v: unknown): number | null => {
    const x = typeof v === "string" ? Number(v) : v;
    return typeof x === "number" && Number.isFinite(x) ? x : null;
  };
  const la = n(lat);
  const lo = n(lng);
  if (la === null || lo === null) return undefined;
  if (Math.abs(la) > 90 || Math.abs(lo) > 180) return undefined;
  if (la === 0 && lo === 0) return undefined;
  return { lat: la, lng: lo };
}

/**
 * When the provider last saw the listing. Prefers the ISO date and falls back to the epoch
 * seconds; returns undefined rather than an Invalid Date, which would poison a timestamp
 * column and every freshness comparison downstream.
 */
function providerSeenAt(l: { last_seen_at_date?: string; last_seen_at?: number }): Date | undefined {
  if (typeof l.last_seen_at_date === "string") {
    const at = Date.parse(l.last_seen_at_date);
    if (Number.isFinite(at)) return new Date(at);
  }
  if (typeof l.last_seen_at === "number" && Number.isFinite(l.last_seen_at)) {
    // The provider sends seconds; JavaScript wants milliseconds.
    return new Date(l.last_seen_at * 1000);
  }
  return undefined;
}

export class MarketCheckAdapter implements IInventoryAdapter {
  readonly name = "marketcheck";
  readonly sourceName = "MarketCheck";

  async search(params: SearchParams): Promise<AdapterRunResult> {
    const start0 = Date.now();
    const apiKey = process.env.MARKETCHECK_API_KEY;

    // Not configured — report NOT_CONFIGURED so the orchestrator SKIPS this source from the
    // health denominator rather than scoring an empty no-op as "100% healthy". A missing
    // credential is never a successful sync.
    if (!apiKey) {
      logger.warn("[MarketCheck adapter] MARKETCHECK_API_KEY not set — skipping. Provision the key in env to activate this source.");
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start0,
        configured: false,
        outcome: "NOT_CONFIGURED",
        fetchedAt: new Date(),
        apiCallsUsed: 0,
      };
    }

    // A market must be configured. There is no default: sweeping some arbitrary city is how
    // the hardcoded-NYC defect stayed invisible for months.
    if (!params.zip) {
      logger.warn("[MarketCheck adapter] no market configured — set inventory_sources.center_zip or INVENTORY_SWEEP_ZIP.");
      return {
        adapter: this.name,
        vehicles: [],
        duration: Date.now() - start0,
        configured: true,
        outcome: "NOT_CONFIGURED",
        error: "no market configured (center_zip / INVENTORY_SWEEP_ZIP)",
        fetchedAt: new Date(),
        apiCallsUsed: 0,
      };
    }

    const rows0 = Math.min(params.rowsPerCall ?? MAX_ROWS_PER_CALL, MAX_ROWS_PER_CALL);
    // Compiled ceiling, min()-ed against whatever was asked for: a corrupt config row
    // claiming max_calls_per_run = 999 cannot raise it.
    const maxCalls = Math.max(1, Math.min(params.maxCalls ?? 1, MAX_CALLS_PER_SWEEP));
    const budget = params.budget;
    const deadline = params.deadlineAt ?? Date.now() + SWEEP_DEADLINE_MS;
    const radiusMiles = Math.min(params.radius ?? DEFAULT_RADIUS_MILES, MAX_RADIUS_MILES);

    const seen = new Map<string, NormalizedVehicle>();
    let start = 0;
    let pagesFetched = 0;
    let pagesFailed = 0;
    let apiCallsUsed = 0;
    let rawListings = 0;
    let numFound: number | null = null;
    let maxDist: number | null = null;
    let outOfRadiusDropped = 0;
    // Bounded, failure-path-only record of WHICH required field was missing on the
    // listings normalize() rejects. Handed to classifyYield, which is where the run's
    // error string is built. A healthy run writes to it and nothing reads it.
    const dropTally = newDropTally();
    let throttle: ThrottleSignal | undefined;
    let stopReason: StopReason | null = null;
    let outcome: AdapterOutcome = "SUCCESS";
    let error: string | undefined;

    while (pagesFetched < maxCalls) {
      // `start + rows` may not exceed 500. Guard on `start >= 500` with the final page
      // trimmed, NOT on `start + rows >= 500`: start=450 with rows=50 is legal and is the
      // tenth page. The stricter form would silently cap every sweep at 9 calls.
      if (start >= PROVIDER_PAGINATION_LIMIT) { stopReason = "PROVIDER_CEILING"; break; }

      // Documented provider rule: `start` past num_found returns HTTP 422. Overrunning the
      // end of the result set is exhaustion, not an error — never spend a call to discover it.
      if (numFound !== null && start >= numFound) { stopReason = "NUM_FOUND_REACHED"; break; }

      const rows = Math.min(rows0, PROVIDER_PAGINATION_LIMIT - start);

      if (Date.now() >= deadline) { stopReason = "DEADLINE"; break; }

      // The budget draw is the LAST statement before dispatch. There is no code path that
      // fetches without a draw, so there is no drawn-but-not-dispatched state and no refund
      // surface at all.
      if (budget && !(await budget.acquire())) {
        stopReason = "BUDGET_EXHAUSTED";
        if (pagesFetched === 0) outcome = "BUDGET_EXHAUSTED";
        else outcome = "PARTIAL";
        break;
      }

      apiCallsUsed++;
      const page = await this.fetchPage(start, rows, radiusMiles, apiKey, params);

      if (page.throttle) throttle = page.throttle;

      // 422 IS THREE DIFFERENT ANSWERS. Classified by message, never by status alone.
      if (page.status === 422) {
        const kind = classify422(page.message);
        if (kind === "PAGINATION_CEILING") {
          // The plan's deep-paging cap. Reaching it is the design: terminate cleanly and
          // keep everything collected. Belt-and-braces behind the pre-fetch guard above.
          stopReason = "PROVIDER_CEILING";
          if (pagesFetched === 0) {
            // Refused before ANY page landed. Nothing was collected and the first request
            // was rejected, so this is a configuration problem, not a completed walk.
            outcome = "FAILED";
            error = `MarketCheck refused the first page at the plan's pagination ceiling: ${page.message ?? "no message"}`;
          }
          break;
        }
        if (kind === "RADIUS_REFUSED") {
          // The configured radius exceeds what the plan allows, so this query returned
          // NOTHING. Reading it as exhaustion is how a swept catalogue goes silently to
          // zero with every run recorded green.
          stopReason = "PROVIDER_RADIUS_REFUSED";
          outcome = pagesFetched === 0 ? "FAILED" : "PARTIAL";
          error = `MarketCheck refused the configured radius (${radiusMiles} miles): ${page.message ?? "no message"}. `
            + `This is a configuration defect, not an empty market.`;
          break;
        }
        if (kind === "INVALID_QUERY") {
          stopReason = "PROVIDER_INVALID_QUERY";
          outcome = pagesFetched === 0 ? "FAILED" : "PARTIAL";
          error = `MarketCheck rejected the query as invalid: ${page.message ?? "no message"}`;
          break;
        }
        // UNKNOWN. Fall through to the ordinary error path below: an unclassified 422 is
        // something we do not understand, and the failure mode of guessing "exhausted" is
        // an empty market shown to a buyer.
      }

      if (!page.ok) {
        pagesFailed++;
        stopReason = "PROVIDER_ERROR";
        error = `MarketCheck HTTP ${page.status} on page ${pagesFetched} (start=${start})`;
        // Page 0 has no partial data — preserve the pre-existing behaviour exactly.
        if (pagesFetched === 0) outcome = page.transient ? "DEFERRED" : "FAILED";
        else outcome = "PARTIAL";
        break;
      }

      pagesFetched++;
      rawListings += page.listings.length;
      // Page 0 ONLY. Later values drift on a live index, and a moving denominator would
      // make the coverage gate judge the run against a number it never targeted.
      if (numFound === null) numFound = page.numFound;

      let newKeys = 0;
      let droppedThisPage = 0;
      for (const l of page.listings) {
        // REJECT A LISTING OUTSIDE THE RADIUS WE ASKED FOR. §9 item 2: the adapter recorded
        // maxDist as evidence the radius took effect and then ingested the row regardless.
        // A listing past the ceiling is not shortlist-eligible, so admitting it puts a card
        // in front of a buyer with a distance they can act on and an action the shortlist
        // gate will refuse. `dist` ABSENT is not `dist` far: an unplaceable listing is kept
        // here and failed closed later by shortlistGate, which is where that judgement lives.
        if (typeof l.dist === "number" && l.dist > radiusMiles) {
          droppedThisPage++;
          outOfRadiusDropped++;
          continue;
        }
        if (typeof l.dist === "number") maxDist = Math.max(maxDist ?? 0, l.dist);
        const v = this.normalize(l, dropTally);
        if (!v) continue;
        const existing = seen.get(v.sourceKey);
        if (!existing) { seen.set(v.sourceKey, v); newKeys++; }
        else if (v.images.length > existing.images.length) seen.set(v.sourceKey, v);
      }

      if (page.listings.length < rows) { stopReason = "SHORT_PAGE"; break; }
      if (numFound !== null && rawListings >= numFound) { stopReason = "NUM_FOUND_REACHED"; break; }
      // A page that contributed nothing new means `start` is being ignored and we are
      // re-reading page 0. Without this guard a 10-call sweep ingests the same 50 listings
      // ten times and reports a healthy run.
      //
      // A page whose rows were ALL rejected for distance is a different condition — the
      // provider is ignoring our radius — and must not be misreported as pagination being
      // ignored. It is left to the coverage gate, which sees the shortfall for what it is.
      if (newKeys === 0 && page.listings.length > droppedThisPage) { stopReason = "NO_NEW_KEYS"; break; }

      start += rows;
      if (pagesFetched < maxCalls) await sleep(MIN_INTER_CALL_MS);
    }

    if (!stopReason) stopReason = "PAGE_CAP";

    const vehicles = Array.from(seen.values());
    // A successful call that returns nothing is ZERO_RESULTS — a legitimate business
    // result, explicitly distinct from an execution failure.
    if (outcome === "SUCCESS" && vehicles.length === 0) outcome = "ZERO_RESULTS";

    // Only now judge whether the run swept what it claimed to. classifyYield can DOWNGRADE
    // a claimed success to FAILED; it never upgrades anything.
    const verdict = classifyYield({
      outcome, numFound, rawListings, normalized: vehicles.length, pagesFetched, rowsPerCall: rows0,
      // A radius rejection is a policy decision, not a response-shape failure. Without this
      // the normalization gate reads every dropped row as normalize() failing on it.
      radiusRejected: outOfRadiusDropped,
      dropTally,
    });

    return {
      adapter: this.name,
      vehicles,
      duration: Date.now() - start0,
      configured: true,
      outcome: verdict.outcome,
      error: verdict.reason ?? error,
      fetchedAt: new Date(),
      apiCallsUsed,
      pagesFetched,
      pagesFailed,
      rawListings,
      numFound,
      stopReason,
      maxDistMiles: maxDist,
      outOfRadiusDropped,
      throttle,
      market: { zip: params.zip, radiusMiles },
      coverage: verdict.coverage,
    };
  }

  private async fetchPage(
    start: number,
    rows: number,
    radiusMiles: number,
    apiKey: string,
    params: SearchParams,
  ): Promise<PageResult> {
    try {
      const url = this.buildApiUrl(params, apiKey, start, rows, radiusMiles);
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "AutoLenis/1.0" },
        signal: AbortSignal.timeout(PER_CALL_TIMEOUT_MS),
      });

      if (!response.ok) {
        // READ THE BODY. A 422's message is the only thing that distinguishes the plan's
        // pagination ceiling from a misconfigured radius from an invalid ZIP, and the
        // retired code branched on the status code alone — which is how all three became
        // "collected everything the provider said existed".
        const raw = await response.text().catch(() => "");
        // 429 / 5xx are transient — retry next run rather than a hard failure.
        return {
          ok: false,
          status: response.status,
          transient: response.status === 429 || response.status >= 500,
          listings: [],
          numFound: null,
          message: messageOf(raw),
          throttle: response.status === 429 ? readThrottle(response.headers) : undefined,
        };
      }

      const data = (await response.json()) as MarketCheckResponse;
      return {
        ok: true,
        status: response.status,
        transient: false,
        listings: data.listings ?? [],
        numFound: typeof data.num_found === "number" ? data.num_found : null,
      };
    } catch (e) {
      const isTimeout = e instanceof Error && /abort|timeout/i.test(e.message);
      logger.error("[MarketCheck adapter] page fetch error:", e);
      // 0 is not a real HTTP status; `transient` is what the caller actually branches on.
      return { ok: false, status: 0, transient: isTimeout, listings: [], numFound: null };
    }
  }

  private buildApiUrl(
    params: SearchParams,
    apiKey: string,
    start: number,
    rows: number,
    radiusMiles: number,
  ): string {
    // Year and mileage are RANGES on this endpoint.
    //
    // The adapter used to send `year_min` / `year_max`, which the provider's schema for
    // /v2/search/car/active does not document — it documents `year_range` as "min-max".
    // Whether the undocumented pair was silently ignored is UNVERIFIED (this session cannot
    // make a keyed call), and an ignored filter is the WORST case rather than the safe one:
    // the query silently widens, so a buyer is shown cars outside their criteria while the
    // code believes it filtered. Send the documented name.
    const yearRange = params.yearMin || params.yearMax
      ? `${params.yearMin ?? 0}-${params.yearMax ?? 9999}`
      : undefined;

    const query = new URLSearchParams({
      api_key: apiKey,
      // The buyer's condition preference (§22a: "filter to the buyer's condition preference"),
      // defaulting to the sweep's long-standing `used` when the caller does not say.
      car_type: params.carType ?? "used",
      include_facets: "false",
      // THE THREE INCLUDE FLAGS. None defaults to true. Probed live 2026-09-10: a query
      // without them returns a listing carrying neither a `dealer` key nor a `build` key —
      // and normalize() derives year/make/model from `build` and every provenance column
      // from `dealer`/`mc_dealership`. Their absence is the probable root cause of "0 of 148
      // active rows carry a dealer reference" and of mc_rooftop_id being NULL on all 221
      // listings and all 1,422 rooftops, leaving no key to join the two halves on.
      include_dealer_object: "true",
      include_mc_dealership_object: "true",
      include_build_object: "true",
      // No `?? "10001"`. An unconfigured market never reaches this function.
      zip: params.zip!,
      // Second, independent clamp on the provider's radius ceiling — the config resolver
      // already clamps, and neither is allowed to be the only guard. Note this is the
      // PROVIDER's cap; AutoLenis's 100-mile POLICY is SHORTLIST_RADIUS_MILES, a separate
      // constant in lib/services/shortlist/shortlist-radius.ts that derives from nothing here.
      radius: String(Math.min(radiusMiles, MAX_RADIUS_MILES)),
      rows: String(Math.min(rows, MAX_ROWS_PER_CALL)),
      start: String(start),
      // Only fetch listings that carry a price, unless the caller sets a real floor.
      //
      // normalize() discards any listing without one — a car with no price cannot be shown
      // to a buyer or taken to a reverse auction — and in the DFW market a THIRD of listings
      // have no price field. Verified live 2026-09-02 at zip 76011 / radius 100: an
      // unfiltered page returned 33 priced listings out of 50, while the same page with a
      // price floor returned 50 of 50. Over a 10-page sweep that is ~330 usable vehicles
      // versus 500, for exactly the same 10 calls against a 500/month cap.
      //
      // It also keeps the coverage gate honest: num_found moves with the filter
      // (92,425 -> 83,223 in that same check), so expected and received still describe the
      // same population.
      price_min: String(params.priceMinCents ? Math.floor(params.priceMinCents / 100) : 1),
      ...(params.make ? { make: params.make } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(yearRange ? { year_range: yearRange } : {}),
      ...(params.milesMax ? { miles_range: `0-${Math.floor(params.milesMax)}` } : {}),
      // Integer cents internally; the provider wants dollars. Converted here and nowhere else.
      ...(params.priceMaxCents ? { price_max: String(Math.floor(params.priceMaxCents / 100)) } : {}),
      ...(params.sortBy ? { sort_by: params.sortBy, sort_order: params.sortOrder ?? "asc" } : {}),
    });
    return `https://api.marketcheck.com/v2/search/car/active?${query.toString()}`;
  }

  private normalize(
    listing: MarketCheckListing,
    tally?: NormalizeDropTally,
  ): NormalizedVehicle | null {
    try {
      const year = listing.build?.year;
      const make = listing.build?.make;
      const model = listing.build?.model;
      const price = listing.price;
      if (!year || !make || !model || !price || price <= 0) {
        // Failure path only, and bounded. `build` is recorded separately from the three
        // fields read off it because an absent `build` fails year, make and model together:
        // the counts alone cannot otherwise tell "the provider sent no build object" from
        // "it sent one with empty fields", and those have different causes and different
        // fixes. Nothing here changes which listings are dropped.
        recordDrop(tally, {
          buildAbsent: !listing.build,
          year: !year,
          make: !make,
          model: !model,
          price: !price || price <= 0,
        });
        return null;
      }

      // `dealer` and `mc_dealership` are independent siblings and either may be absent, so
      // the shared facts are read from whichever arrived. Both carried identical values on
      // every listing observed; preferring `dealer` keeps the previous behaviour exactly
      // where both are present, and stops a listing losing its whole provenance when only
      // one object comes back.
      const d = listing.dealer;
      const mc = listing.mc_dealership;
      const pick = (a: unknown, b: unknown): string | undefined => text(a) ?? text(b);

      const coords =
        coordinates(d?.latitude, d?.longitude) ?? coordinates(mc?.latitude, mc?.longitude);

      const vehicle: NormalizedVehicle = {
        vin: listing.vin,
        year,
        make,
        model,
        trim: listing.build?.trim,
        mileage: listing.miles,
        priceCents: Math.round(price * 100),
        images: listing.media?.photo_links?.slice(0, 6) ?? [],
        externalDealerName: pick(d?.name, mc?.name),
        externalDealerPhone: pick(d?.phone, mc?.phone),
        externalDealerCity: pick(d?.city, mc?.city),
        externalDealerState: pick(d?.state, mc?.state),
        externalDealerStreet: pick(d?.street, mc?.street),
        externalDealerZip: pick(d?.zip, mc?.zip),
        externalDealerEmail: text(d?.seller_email),
        externalDealerType: pick(d?.dealer_type, mc?.dealer_type),
        // The rooftop graph's strongest key, and previously discarded at the type boundary:
        // `dealer.website` was not even declared, so it was dropped before any decision was
        // made. `DealerRooftop.websiteHost` is @unique and `dealer_rooftops` carries no
        // phone or email column at all, which makes this the join key rather than one of
        // several.
        externalDealerWebsite: pick(d?.website, mc?.website),

        // ── The identifiers, from the object that actually carries them ──────────
        //
        // ONLY `mc_dealership` has these. Reading them off `dealer` returned undefined on
        // every listing, and the old `?? dealer.id` fallback for the dealer id was not a
        // weaker version of the same key: `dealer.id` IS `mc_website_id`, a different
        // space, so it wrote a website id into a dealer-id column. Nothing is lost by
        // removing it — `mcWebsiteId` captures `dealer.id` under its real name.
        mcRooftopId: text(mc?.mc_rooftop_id),
        mcDealerId: text(mc?.mc_dealer_id),
        mcLocationId: text(mc?.mc_location_id),
        mcWebsiteId: text(mc?.mc_website_id) ?? text(d?.id),
        // "Dealer" | "Retailer" | "Dealership Group" | "Aggregator" | "Marketing" |
        // "Financing". Rooftop resolution filters to the first three: an aggregator is not
        // a rooftop that can be invited to an auction.
        mcCategory: text(mc?.mc_category),

        // The listing-VERSION key. Changes when price or miles change, so it is not the
        // vehicle's identity (VIN is) — it is how a price change is recognised as the same
        // car re-listed rather than a new one.
        listingId: text(listing.id),
        // When the PROVIDER last saw it, which is the clock §22a's 7-day note and 30-day
        // shortlist block should read. Our own `lastSeenAt` records when OUR sweep last saw
        // it, and the two diverge exactly when a sweep stops running — which is the case
        // the freshness rules exist for.
        providerLastSeenAt: providerSeenAt(listing),
        // Days active at the CURRENT dealer. The provider's own default staleness metric
        // (`dos_active`, not `dom_active`, which spans dealer transfers).
        daysOnLot: typeof listing.dos_active === "number" ? listing.dos_active : undefined,

        // The listing's own location IS the holding dealership's location. Writing it here
        // fills InventoryItem.city/state/zip/latitude/longitude, which the adapter had never
        // populated — the reason distance was NULL on every row.
        city: pick(d?.city, mc?.city),
        state: pick(d?.state, mc?.state),
        zip: pick(d?.zip, mc?.zip),
        latitude: coords?.lat,
        longitude: coords?.lng,
        externalListingUrl: listing.vdp_url,
        sourceAdapter: this.name,
        sourceUrl: "https://www.marketcheck.com",
        sourceKey: "",
      };
      vehicle.sourceKey = buildSourceKey(vehicle);
      return vehicle;
    } catch {
      // Not a predicate failing, and counted so `sampled` stays a true partition of what was
      // inspected rather than a total with an unexplained remainder.
      recordDrop(tally, { threw: true });
      return null;
    }
  }
}
