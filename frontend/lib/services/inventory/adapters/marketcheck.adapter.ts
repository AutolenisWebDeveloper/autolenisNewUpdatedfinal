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
import { classifyYield } from "../sync-yield";

/** 250ms between calls = 4 req/s, under the 5 req/s free-tier limit. */
const MIN_INTER_CALL_MS = 250;
/** Per-call timeout. Lower than the old 20s because a sweep now makes up to 10 calls. */
const PER_CALL_TIMEOUT_MS = 12_000;
/** Wall-clock stop for the whole walk, well inside the route's maxDuration of 300s. */
const SWEEP_DEADLINE_MS = 90_000;

interface MarketCheckListing {
  id?: string;
  vin?: string;
  /** Distance in miles from the query centre. The cheapest proof the radius took effect. */
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
  };
  miles?: number;
  price?: number;
  msrp?: number;
  exterior_color?: string;
  interior_color?: string;
  media?: { photo_links?: string[] };
  vdp_url?: string;
  /**
   * The provider's dealership object. Everything here is optional and untrusted: field
   * presence varies by rooftop, `mc_dealer_id` is sometimes only the numeric `id`, and
   * coordinates are occasionally 0,0 or out of range. Read defensively, never assumed.
   */
  dealer?: {
    id?: number | string;
    name?: string;
    phone?: string;
    street?: string;
    city?: string;
    state?: string;
    zip?: string;
    latitude?: number | string;
    longitude?: number | string;
    seller_email?: string;
    dealer_type?: string;
    mc_rooftop_id?: number | string;
    mc_dealer_id?: number | string;
  };
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

      // 422 = start past the end of the result set. Belt-and-braces behind the pre-fetch
      // guard above: terminate cleanly, keep everything collected, record no failure.
      // Without this branch a COMPLETE sweep would fall into the 4xx path and report FAILED.
      if (page.status === 422) { stopReason = "NUM_FOUND_REACHED"; break; }

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
      for (const l of page.listings) {
        if (typeof l.dist === "number") maxDist = Math.max(maxDist ?? 0, l.dist);
        const v = this.normalize(l);
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
      if (newKeys === 0 && page.listings.length > 0) { stopReason = "NO_NEW_KEYS"; break; }

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
        // 429 / 5xx are transient — retry next run rather than a hard failure.
        return {
          ok: false,
          status: response.status,
          transient: response.status === 429 || response.status >= 500,
          listings: [],
          numFound: null,
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
    const query = new URLSearchParams({
      api_key: apiKey,
      car_type: "used",
      include_facets: "false",
      // No `?? "10001"`. An unconfigured market never reaches this function.
      zip: params.zip!,
      // Second, independent clamp on the provider's radius ceiling — the config resolver
      // already clamps, and neither is allowed to be the only guard.
      radius: String(Math.min(radiusMiles, MAX_RADIUS_MILES)),
      rows: String(Math.min(rows, MAX_ROWS_PER_CALL)),
      start: String(start),
      // Only fetch listings that carry a price.
      //
      // normalize() discards any listing without one — a car with no price cannot be shown
      // to a buyer or taken to a reverse auction — and in the DFW market a THIRD of listings
      // have no price field. Verified live 2026-09-02 at zip 76011 / radius 100:
      // an unfiltered page returned 33 priced listings out of 50, while the same page with a
      // price floor returned 50 of 50. Over a 10-page sweep that is ~330 usable vehicles
      // versus 500, for exactly the same 10 calls against a 500/month cap.
      //
      // It also keeps the coverage gate honest: num_found moves with the filter
      // (92,425 -> 83,223 in that same check), so expected and received still describe the
      // same population.
      //
      // `price_max` is already proven on this endpoint in production traffic; `price_min` is
      // its documented partner. This sandbox's egress proxy blocks api.marketcheck.com, so
      // the pair could not be re-verified against the raw endpoint here — but an ignored
      // filter degrades to exactly today's behaviour, and the run records rawListings vs
      // normalized either way, so a no-op would be visible rather than silent.
      price_min: "1",
      ...(params.make ? { make: params.make } : {}),
      ...(params.model ? { model: params.model } : {}),
      ...(params.yearMin ? { year_min: String(params.yearMin) } : {}),
      ...(params.yearMax ? { year_max: String(params.yearMax) } : {}),
      // Integer cents internally; the provider wants dollars. Converted here and nowhere else.
      ...(params.priceMaxCents ? { price_max: String(Math.floor(params.priceMaxCents / 100)) } : {}),
    });
    return `https://api.marketcheck.com/v2/search/car/active?${query.toString()}`;
  }

  private normalize(listing: MarketCheckListing): NormalizedVehicle | null {
    try {
      const year = listing.build?.year;
      const make = listing.build?.make;
      const model = listing.build?.model;
      const price = listing.price;
      if (!year || !make || !model || !price || price <= 0) return null;

      const coords = coordinates(listing.dealer?.latitude, listing.dealer?.longitude);

      const vehicle: NormalizedVehicle = {
        vin: listing.vin,
        year,
        make,
        model,
        trim: listing.build?.trim,
        mileage: listing.miles,
        priceCents: Math.round(price * 100),
        images: listing.media?.photo_links?.slice(0, 6) ?? [],
        externalDealerName: text(listing.dealer?.name),
        externalDealerPhone: text(listing.dealer?.phone),
        externalDealerCity: text(listing.dealer?.city),
        externalDealerState: text(listing.dealer?.state),
        externalDealerStreet: text(listing.dealer?.street),
        externalDealerZip: text(listing.dealer?.zip),
        externalDealerEmail: text(listing.dealer?.seller_email),
        externalDealerType: text(listing.dealer?.dealer_type),
        // `mc_dealer_id` is the documented field, but plenty of rooftops carry only the
        // numeric `id`. Falling back keeps the strongest join key we have rather than none.
        mcRooftopId: text(listing.dealer?.mc_rooftop_id),
        mcDealerId: text(listing.dealer?.mc_dealer_id) ?? text(listing.dealer?.id),
        // The listing's own location IS the holding dealership's location. Writing it here
        // fills InventoryItem.city/state/zip/latitude/longitude, which the adapter has never
        // populated — the reason distance was NULL on every row.
        city: text(listing.dealer?.city),
        state: text(listing.dealer?.state),
        zip: text(listing.dealer?.zip),
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
      return null;
    }
  }
}
