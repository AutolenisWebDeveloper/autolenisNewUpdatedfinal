// Block B / Apollo — dealer internet-sales contact reveal adapter.
//
// 3-stage shape, corrected against Apollo's own contract in the API-contract
// batch (see the endpoint table in that PR):
//   1. resolve the dealer → canonical Apollo ORG. PAID. With a domain this is
//      GET organizations/enrich (1 credit if found, 0 if not); without one it is
//      POST mixed_companies/search by name + city/state (1 credit per request
//      that returns any result). The previous implementation called
//      POST organizations/lookup with q_organization_name/q_organization_domains,
//      which is not the documented Organization Search request: production shows
//      every one of the 500 staged attempts stopping here with no_org, including
//      39 rooftops with real, working domains.
//   2. people search by organization_id + ranked sales titles on
//      POST mixed_people/api_search. FREE — Apollo's pricing page lists
//      enrichment and organization search as credit-consuming; people search is
//      not on that list. Take the best-title person.
//   3. reveal (people/match) ONLY that person — 1 credit on a match.
//
// THE INVARIANT CHANGED: stage 1 is no longer free. A full reveal is worth
// ORG_RESOLVE_COST_CREDITS + the match credit, and the adapter reports EXACTLY
// how many credits a run may have consumed (`creditsBilled`) so the ledger
// orchestration in apollo-reveal.service — which draws the worst case BEFORE
// calling here — refunds only what Apollo documents as free. Nothing in this
// module touches the ledger itself; it only talks to Apollo and reports.
//
// BILLING RULES, per stage, never undercounting:
//   stage 1  found → 1. Clean 2xx miss → 0 (Apollo: "0 credits if not found" /
//            "0 credits if there are no matches"). Any non-2xx or transport
//            failure → 1: whether Apollo charged is unknowable, and a wrong
//            endpoint path burning phantom ledger credits is a LOUD failure —
//            the silent kind is what this batch is correcting.
//   stage 2  free. A failure here is recorded as its own stage, because the
//            paid stage before it succeeded and that credit is kept.
//   stage 3  match → +1 (email or not). Clean no-match → +0. Error → +1.
//
// The live HTTP client is isolated in buildApolloClient; the orchestration is
// unit-tested by injecting a fake ApolloClient. apolloRequest is exported for
// the admin contract probe, which needs the raw status and envelope.

import { logger } from "@/lib/logger";
import { normalizeDealerName, normalizeWebsiteHost } from "@/lib/services/dealer/dealer-identity.service";

const APOLLO_BASE_URL = (process.env.APOLLO_BASE_URL ?? "https://api.apollo.io/api/v1").replace(/\/$/, "");
const APOLLO_TIMEOUT_MS = 12_000;

/**
 * What stage 1 costs when it finds an organization. Both documented resolvers
 * bill one credit on a hit: organizations/enrich "exactly 1 credit if found",
 * mixed_companies/search "exactly 1 credit per request that returns at least
 * one result". A miss on either is documented as free.
 */
export const ORG_RESOLVE_COST_CREDITS = 1;

/** What stage 3 costs on a match. Mirrors REVEAL_COST_CREDITS in apollo-reveal.service. */
export const PEOPLE_MATCH_COST_CREDITS = 1;

// Ranked sales-facing titles for the people-search (similar-titles ON — Apollo
// titles are freeform, so we normalize on our side, not via exact match).
export const APOLLO_SALES_TITLES = [
  "Internet Sales Manager",
  "Internet Sales Director",
  "BDC Manager",
  "Sales Manager",
  "General Sales Manager",
] as const;

// Ranked title keywords (best-first) for choosing among flag-positive people.
const RANKED_TITLE_KEYWORDS = ["internet sales", "bdc", "general sales", "sales manager", "sales"] as const;
function titleRank(title: string | null | undefined): number {
  const t = (title ?? "").toLowerCase();
  for (let i = 0; i < RANKED_TITLE_KEYWORDS.length; i++) {
    if (t.includes(RANKED_TITLE_KEYWORDS[i])) return i;
  }
  return RANKED_TITLE_KEYWORDS.length; // unranked title → lowest priority
}

// ─── Phase 1.2 — People Search (the 0-CREDIT acquisition path) ──────────────
//
// The 3-stage reveal above now starts from a PAID organization resolution.
// Website coverage across dealer_rooftops is 74/1,422, so that path cannot even
// attempt ~95% of the list. People Search keys on SIC code + title + location
// instead, needs no domain, and is not on Apollo's list of credit-consuming
// endpoints — which makes it the primary way candidates enter the system.
//
// Nothing in this section may call a billable endpoint.

/** SIC 5511 — new and used car dealers. */
export const DEALER_SIC_CODES = ["5511"] as const;

/** Decision-maker titles worth contacting at a rooftop, broad-to-specific. */
export const DEALER_PERSON_TITLES = [
  "dealer principal",
  "general manager",
  "general sales manager",
  "used car manager",
  "internet sales manager",
  "sales manager",
  "inventory manager",
  "acquisition manager",
] as const;

/**
 * One People Search hit. The last name arrives OBFUSCATED (e.g. "R.") because
 * the record has not been revealed — that is expected at this stage and is not
 * missing data. Matching to a rooftop uses the organization fields, which are
 * returned in full.
 */
export interface ApolloSearchPerson {
  id: string;
  firstName: string | null;
  lastNameObfuscated: string | null;
  title: string | null;
  linkedinUrl: string | null;
  organization: {
    id: string | null;
    name: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    domain: string | null;
  } | null;
}

export interface ApolloPeopleSearchPage {
  people: ApolloSearchPerson[];
  totalPages: number;
  totalEntries: number;
}

export interface ApolloOrg {
  id: string;
  domain?: string | null;
  name?: string | null;
}

/**
 * Stage-1 result. `billed` is what Apollo's pricing page says the call cost:
 * true when the endpoint returned a qualifying record (found / any match), false
 * on a clean miss. A transport or HTTP failure is not a result — the client
 * THROWS, and the adapter treats that as billed.
 */
export interface ApolloOrgResolution {
  org: ApolloOrg | null;
  billed: boolean;
  /** Which documented resolver answered — diagnostic. */
  resolver: "organizations/enrich" | "mixed_companies/search";
}

export interface ApolloPerson {
  id: string;
  name?: string | null;
  title?: string | null;
  hasEmail: boolean;
}

export interface ApolloRevealed {
  email: string | null;
  name?: string | null;
  title?: string | null;
}

/**
 * WHICH of the three stages produced an `empty` outcome, and what that stage
 * had cost by the time it stopped. `creditsBilled` on the outcome is the sole
 * authority for what the ledger keeps; the stage names where the run stopped.
 *
 *   disabled             no client — no API key, or APOLLO_REVEAL_ENABLED is
 *                        not "true". Nothing was asked of Apollo.        (0)
 *   no_org               stage 1 answered cleanly and found nothing.
 *                        enrich: 0 credits if not found. search: 0 credits
 *                        with no matches; but a search that RETURNED matches
 *                        none of which carried an organization id is a
 *                        billed miss, and is reported as such.        (0 or 1)
 *   org_error            stage 1 returned a non-2xx or failed in transport.
 *                        Unknowable whether Apollo charged; assumed so.   (1)
 *   no_people            stage 1 found the org; stage 2 returned no people. (1)
 *   people_search_error  stage 1 found the org; stage 2 THREW. Distinct from
 *                        no_people because the org credit is already spent
 *                        and an errored search is worth retrying.         (1)
 *   no_match             stage 3 matched no person: a clean 200, which Apollo
 *                        does not charge for.                              (1)
 *   match_no_email       stage 3 matched a person carrying no work email —
 *                        Apollo charges for the match regardless.         (2)
 *   match_error          stage 3 errored; whether Apollo charged is
 *                        unknowable, so treated as charged.               (2)
 *
 * Rows written before the API-contract batch may carry the retired value
 * `free_stage_error` (a stage-1-or-2 throw back when stage 1 was believed free).
 * They are not rewritten — the stage that produced them was recorded truthfully
 * at the time.
 */
export type ApolloEmptyStage =
  | "disabled"
  | "no_org"
  | "org_error"
  | "no_people"
  | "people_search_error"
  | "no_match"
  | "match_no_email"
  | "match_error";

/**
 * Outcome of a reveal attempt. `creditsBilled` is how many credits Apollo
 * charged, or MAY have charged, for the calls this attempt made — the number the
 * ledger keeps out of whatever was drawn up front. It is never a guess in the
 * cheap direction: an unknowable is counted as charged.
 */
export type ApolloRevealOutcome =
  | { kind: "revealed"; email: string; name: string | null; title: string | null; creditsBilled: number }
  | { kind: "empty"; creditsBilled: number; stage: ApolloEmptyStage };

/** Worst case a single attempt can bill: stage 1 found + stage 3 matched. */
export const MAX_CREDITS_PER_ATTEMPT = ORG_RESOLVE_COST_CREDITS + PEOPLE_MATCH_COST_CREDITS;

// The seam the orchestration depends on — injectable so the 3-stage logic is
// unit-tested without live HTTP.
export interface ApolloClient {
  /**
   * Stage 1 — PAID. Resolves to a canonical organization, reporting whether the
   * call was billable. THROWS on a non-2xx or transport failure; the adapter
   * treats a throw as billed.
   */
  resolveOrganization(input: {
    name: string;
    domain?: string | null;
    city?: string | null;
    state?: string | null;
  }): Promise<ApolloOrgResolution>;
  /**
   * Stage 2 — FREE. People at the organization by ranked titles. THROWS on a
   * non-2xx or transport failure so the adapter can name the stage; it never
   * collapses an error into "no people", because the credit spent on stage 1 is
   * already gone and a retryable failure must not look like a genuine miss.
   */
  peopleSearch(input: { organizationId: string; titles: readonly string[] }): Promise<ApolloPerson[]>;
  peopleMatch(personId: string): Promise<ApolloRevealed | null>; // the paid reveal
}

/**
 * The DISCOVERY seam, deliberately separate from ApolloClient.
 *
 * Discovery and reveal are different capabilities with different cost profiles:
 * reveal spends credits, search does not. Folding peopleSearchByCriteria into
 * ApolloClient would force every reveal-path fake to implement a method it never
 * calls, and would let a caller holding a "client" reach a capability it has no
 * business using. Two interfaces; the concrete client satisfies both.
 */
export interface ApolloSearchClient {
  /** FREE. Criteria-driven discovery; never bills. */
  peopleSearchByCriteria(input: {
    sicCodes: readonly string[];
    titles: readonly string[];
    personLocations?: readonly string[];
    organizationLocations?: readonly string[];
    page: number;
    perPage: number;
  }): Promise<ApolloPeopleSearchPage>;
}

export interface ApolloAdapterInput {
  name: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  /**
   * The rooftop this reveal is for. DIAGNOSTIC ONLY — never sent to Apollo, and
   * it changes neither what is asked nor what is billed. It exists so the
   * per-stage logs of a single run read as a per-rooftop drop-off funnel.
   */
  rooftopId?: string | null;
}

export interface ApolloAdapterDeps {
  client: ApolloClient | null;
}

/** True only when the tier is both configured (key) and explicitly enabled. */
export function apolloEnabled(): boolean {
  return !!process.env.APOLLO_API_KEY && process.env.APOLLO_REVEAL_ENABLED === "true";
}

/**
 * Gate for the FREE People Search path. Deliberately separate from
 * apolloEnabled(): that flag governs SPENDING, and discovery costs nothing, so
 * tying them together would force the owner to enable paid reveals in order to
 * populate candidates. Both still require a key, and both default OFF.
 */
export function apolloPeopleSearchEnabled(): boolean {
  return !!process.env.APOLLO_API_KEY && process.env.APOLLO_PEOPLE_SEARCH_ENABLED === "true";
}

/**
 * Resolve a dealer to a revealed internet-sales contact. Never throws (fail-closed).
 * Returns an ApolloRevealOutcome carrying `creditsBilled` — what Apollo charged or
 * may have charged — plus, on a miss, the `stage` that produced it.
 *
 * Callers MUST have drawn MAX_CREDITS_PER_ATTEMPT before calling: stage 1 and
 * stage 3 are both paid, and the draw has to precede the call that spends.
 */
export async function apolloResolveAndReveal(
  input: ApolloAdapterInput,
  deps?: Partial<ApolloAdapterDeps>,
): Promise<ApolloRevealOutcome> {
  const client = deps?.client ?? defaultApolloClient();
  // no key / disabled → fail closed, nothing asked of Apollo, nothing billed
  if (!client) return { kind: "empty", creditsBilled: 0, stage: "disabled" };

  // Rooftop key for the funnel logs. Absent only when a caller other than the
  // reveal orchestration drives the adapter; "unknown" keeps the line shape
  // stable so a grep never silently misses a row.
  const rooftop = input.rooftopId ?? "unknown";

  // Stage 1 — PAID canonical org resolution.
  let org: ApolloOrg;
  try {
    const resolved = await client.resolveOrganization({
      name: input.name,
      domain: normalizeWebsiteHost(input.website),
      city: input.city,
      state: input.state,
    });
    // INFO, not warn: an unresolved org is an ordinary outcome for a dealer
    // Apollo does not carry, not a fault. Logged BEFORE the miss return so the
    // funnel shows the drop-off rather than only the rows that got through.
    logger.info(
      `[apollo] stage 1 ${resolved.resolver} — rooftop=${rooftop} org=${resolved.org?.id ?? "none"} ` +
        `billed=${resolved.billed} dealer="${input.name}"`,
    );
    if (!resolved.org) {
      return { kind: "empty", creditsBilled: resolved.billed ? ORG_RESOLVE_COST_CREDITS : 0, stage: "no_org" };
    }
    org = resolved.org;
  } catch (err) {
    // The billable call failed in a way that leaves the charge unknowable.
    // Counted as charged: a wrong path that quietly cost nothing is the failure
    // mode this whole batch exists to end.
    logger.warn(`[apollo] stage 1 org resolution failed — rooftop=${rooftop} dealer="${input.name}":`, err);
    return { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "org_error" };
  }

  // Stage 2 — FREE people by org + ranked titles; pick the BEST-TITLE-ranked
  // person and reveal that one. Selection is title-first and does NOT gate on the
  // has_email flag: on some Apollo plans People Search returns has_email:false
  // for real, revealable contacts (confirmed live — a genuine sales manager came
  // back has_email:false), so gating on the flag would filter everyone out and
  // the tier would silently reveal nothing. We accept that some reveals come back
  // empty. The flag is used only as a tiebreaker among equal titles.
  let target: ApolloPerson;
  try {
    const people = await client.peopleSearch({ organizationId: org.id, titles: APOLLO_SALES_TITLES });
    logger.info(`[apollo] stage 2 people search — rooftop=${rooftop} org=${org.id} people=${people.length}`);
    if (people.length === 0) return { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "no_people" };
    target = [...people].sort((a, b) => {
      const byTitle = titleRank(a.title) - titleRank(b.title);
      if (byTitle !== 0) return byTitle;
      return (b.hasEmail ? 1 : 0) - (a.hasEmail ? 1 : 0); // tie → prefer a flagged email
    })[0];
  } catch (err) {
    // Free stage, but the org credit before it is already spent and is kept.
    logger.warn(`[apollo] stage 2 people search failed — rooftop=${rooftop} org=${org.id}:`, err);
    return { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "people_search_error" };
  }

  // Stage 3 — the PAID people/match. Apollo charges a lead credit when it matches a
  // person (email or not), so anything other than a clean "no person matched" is
  // treated as billed → the ledger keeps the credit (conservative: never undercount).
  try {
    const revealed = await client.peopleMatch(target.id);
    // no person matched → the match credit is not charged; the org credit was
    if (revealed === null) return { kind: "empty", creditsBilled: ORG_RESOLVE_COST_CREDITS, stage: "no_match" };
    // matched, no email → billed for the match too
    if (!revealed.email) return { kind: "empty", creditsBilled: MAX_CREDITS_PER_ATTEMPT, stage: "match_no_email" };
    return {
      kind: "revealed",
      email: revealed.email,
      name: revealed.name ?? null,
      title: revealed.title ?? null,
      creditsBilled: MAX_CREDITS_PER_ATTEMPT,
    };
  } catch (err) {
    // The billable call errored — we cannot know whether Apollo charged, so assume
    // it did (never undercount). Ledger keeps both credits; the cycle claim goes EMPTY.
    logger.warn(`[apollo] people/match failed — rooftop=${rooftop} dealer="${input.name}":`, err);
    return { kind: "empty", creditsBilled: MAX_CREDITS_PER_ATTEMPT, stage: "match_error" };
  }
}

// ─── default live client ─────────────────────────────────────────────────────

/** Raw outcome of one Apollo HTTP call. Never thrown; the caller decides. */
export type ApolloHttpResult =
  | { kind: "http"; status: number; ok: boolean; json: unknown | null }
  | { kind: "transport"; error: string }
  | { kind: "no_key" };

export interface ApolloRequestInput {
  method: "GET" | "POST";
  /** Query-string parameters (GET, or POST alongside a body). Arrays become key[]=v. */
  query?: Record<string, string | number | boolean | readonly string[] | undefined>;
  /** JSON body (POST only). */
  body?: Record<string, unknown>;
}

function buildQuery(query: ApolloRequestInput["query"]): string {
  if (!query) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) sp.append(`${k}[]`, String(item));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

/**
 * One Apollo HTTP call, reported raw. This is the single transport path: the
 * typed client methods and the admin contract probe both sit on it, so the
 * probe exercises exactly the code the reveal runs. Never throws — a missing key
 * is reported as `no_key` (fail closed, nothing sent), a timeout or network
 * failure as `transport`, and any HTTP answer as `http` with its status and
 * parsed body (null when the body is not JSON).
 */
export async function apolloRequest(path: string, input: ApolloRequestInput): Promise<ApolloHttpResult> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return { kind: "no_key" };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), APOLLO_TIMEOUT_MS);
  try {
    const res = await fetch(`${APOLLO_BASE_URL}${path}${buildQuery(input.query)}`, {
      method: input.method,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        "X-Api-Key": key,
      },
      ...(input.method === "POST" && input.body ? { body: JSON.stringify(input.body) } : {}),
      signal: ac.signal,
    });
    let json: unknown | null = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { kind: "http", status: res.status, ok: res.ok, json };
  } catch (err) {
    return { kind: "transport", error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Convenience over apolloRequest for the two behaviours the client needs:
 *   - throwOnError:false  → a non-2xx, a transport failure or a missing key
 *                           collapses to null (fail closed). Safe ONLY for a
 *                           call that cannot bill.
 *   - throwOnError:true   → THROWS on any of those, so a billable call's error
 *                           can never be mistaken for a clean "no result".
 */
async function apolloFetch(
  path: string,
  input: ApolloRequestInput,
  opts?: { throwOnError?: boolean },
): Promise<unknown | null> {
  const r = await apolloRequest(path, input);
  if (r.kind === "no_key") {
    if (opts?.throwOnError) throw new Error(`[apollo] missing API key on ${path}`);
    return null;
  }
  if (r.kind === "transport") {
    logger.warn(`[apollo] request failed on ${path}: ${r.error}`);
    if (opts?.throwOnError) throw new Error(`[apollo] request failed on ${path}: ${r.error}`);
    return null;
  }
  if (!r.ok) {
    logger.warn(`[apollo] HTTP ${r.status} on ${path}`);
    if (opts?.throwOnError) throw new Error(`[apollo] HTTP ${r.status} on ${path}`);
    return null;
  }
  return r.json;
}

/** Top-level keys of an envelope, for a log line that names what Apollo actually sent. */
function envelopeKeys(json: unknown): string {
  return json && typeof json === "object" ? Object.keys(json as object).join(",") : typeof json;
}

/**
 * Real Apollo client for the SEARCH path only. Gated on the search flag rather
 * than the reveal flag, because searching does not spend. Returns the same
 * object; the caller only reaches peopleSearchByCriteria.
 */
export function defaultApolloSearchClient(): ApolloSearchClient | null {
  if (!apolloPeopleSearchEnabled()) return null;
  return buildApolloClient();
}

/** Real Apollo client, or null when unconfigured/disabled (tier stays off). */
export function defaultApolloClient(): ApolloClient | null {
  if (!apolloEnabled()) return null;
  return buildApolloClient();
}

/** Shape of one organization row as Apollo returns it (fields we read). */
interface OrgRow {
  id?: string | null;
  organization_id?: string | null;
  name?: string | null;
  primary_domain?: string | null;
  domain?: string | null;
}

function buildApolloClient(): ApolloClient & ApolloSearchClient {
  return {
    async resolveOrganization({ name, domain, city, state }) {
      // WITH a domain: Organization Enrichment — the canonical single-company
      // lookup, matched on the domain exactly. "Exactly 1 credit if found. 0
      // credits if not found." Only the parameter Apollo's own schema declares
      // (`domain`) is sent; an unverified extra parameter could turn a hit into
      // a 4xx and a real credit into an unknowable one.
      if (domain) {
        const r = await apolloRequest("/organizations/enrich", { method: "GET", query: { domain } });
        if (r.kind === "no_key") throw new Error("[apollo] missing API key on /organizations/enrich");
        if (r.kind === "transport") throw new Error(`[apollo] request failed on /organizations/enrich: ${r.error}`);
        if (!r.ok) throw new Error(`[apollo] HTTP ${r.status} on /organizations/enrich`);
        const org = (r.json as { organization?: OrgRow | null } | null)?.organization;
        if (!org?.id) {
          // A 2xx that does not carry an organization is the documented free
          // miss. Naming the keys makes a wrong envelope assumption visible in
          // the logs rather than indistinguishable from a real not-found.
          logger.info(`[apollo] organizations/enrich 2xx without organization — keys=${envelopeKeys(r.json)}`);
          return { org: null, billed: false, resolver: "organizations/enrich" };
        }
        return {
          org: { id: org.id, domain: org.primary_domain ?? null, name: org.name ?? null },
          billed: true,
          resolver: "organizations/enrich",
        };
      }

      // WITHOUT a domain: Organization Search by name, narrowed to the rooftop's
      // city/state. "Exactly 1 credit per request that returns at least one
      // result. 0 credits if there are no matches." The envelope is TWO buckets:
      // `organizations` (net-new; `id` IS the organization id, domain in
      // `primary_domain`) and `accounts` (already saved by the team; `id` is an
      // ACCOUNT id and the organization id is `organization_id`, domain in
      // `domain`). Reading organizations[0] alone silently misses every company
      // the team has already saved.
      const location = [city, state].filter((v) => v && v.trim()).join(", ");
      const r = await apolloRequest("/mixed_companies/search", {
        method: "POST",
        body: {
          q_organization_name: name,
          ...(location ? { organization_locations: [location] } : {}),
          page: 1,
          per_page: 5,
        },
      });
      if (r.kind === "no_key") throw new Error("[apollo] missing API key on /mixed_companies/search");
      if (r.kind === "transport") throw new Error(`[apollo] request failed on /mixed_companies/search: ${r.error}`);
      if (!r.ok) throw new Error(`[apollo] HTTP ${r.status} on /mixed_companies/search`);

      const json = r.json as { organizations?: OrgRow[]; accounts?: OrgRow[] } | null;
      const organizations = json?.organizations ?? [];
      const accounts = json?.accounts ?? [];
      const candidates: ApolloOrg[] = [
        ...organizations.map((o) => ({ id: o.id ?? null, domain: o.primary_domain ?? null, name: o.name ?? null })),
        ...accounts.map((a) => ({ id: a.organization_id ?? null, domain: a.domain ?? null, name: a.name ?? null })),
      ].flatMap((c) => (c.id ? [{ id: c.id, domain: c.domain, name: c.name }] : []));

      // Any returned match is billed, whatever we do with it.
      const billed = organizations.length + accounts.length > 0;
      if (candidates.length === 0) {
        if (billed) logger.warn(`[apollo] mixed_companies/search returned matches with no organization id — keys=${envelopeKeys(r.json)}`);
        return { org: null, billed, resolver: "mixed_companies/search" };
      }

      // Prefer the candidate whose normalized name is ours; otherwise the first.
      // Never silently guess between two: log which rule chose.
      const wanted = normalizeDealerName(name);
      const exact = wanted ? candidates.find((c) => normalizeDealerName(c.name) === wanted) : undefined;
      const chosen = exact ?? candidates[0];
      logger.info(
        `[apollo] mixed_companies/search chose ${chosen.id} by ${exact ? "name key" : "first result"} ` +
          `of ${candidates.length} candidate(s) (${organizations.length} organizations, ${accounts.length} accounts)`,
      );
      return { org: chosen, billed, resolver: "mixed_companies/search" };
    },
    async peopleSearch({ organizationId, titles }) {
      // FREE, and throwOnError so an error is reported as its own stage: the
      // org credit before this call is already spent, and a retryable failure
      // must not be recorded as a genuine "no people".
      const json = (await apolloFetch(
        "/mixed_people/api_search",
        {
          method: "POST",
          body: {
            organization_ids: [organizationId],
            person_titles: [...titles],
            include_similar_titles: true,
            page: 1,
            per_page: 10,
          },
        },
        { throwOnError: true },
      )) as { people?: Array<{ id?: string; name?: string; title?: string; email_status?: string; has_email?: boolean }> } | null;
      return (json?.people ?? [])
        .filter((p) => p.id)
        .map((p) => ({
          id: p.id as string,
          name: p.name ?? null,
          title: p.title ?? null,
          // Apollo signals a fetchable email via email_status "verified"/"likely"
          // (or has_email). A masked/unavailable status is treated as no email.
          hasEmail: p.has_email === true || p.email_status === "verified" || p.email_status === "likely",
        }));
    },
    async peopleSearchByCriteria({ sicCodes, titles, personLocations, organizationLocations, page, perPage }) {
      // A FREE stage: no throwOnError, so a transport failure degrades to an
      // empty page rather than throwing into the caller's pagination loop. It
      // cannot have billed, because people search does not bill.
      const json = (await apolloFetch("/mixed_people/api_search", {
        method: "POST",
        body: {
          organization_sic_codes: [...sicCodes],
          person_titles: [...titles],
          include_similar_titles: true,
          ...(personLocations?.length ? { person_locations: [...personLocations] } : {}),
          ...(organizationLocations?.length ? { organization_locations: [...organizationLocations] } : {}),
          page,
          per_page: perPage,
        },
      })) as {
        people?: Array<{
          id?: string;
          first_name?: string | null;
          last_name?: string | null;
          name?: string | null;
          title?: string | null;
          linkedin_url?: string | null;
          organization?: {
            id?: string | null;
            name?: string | null;
            city?: string | null;
            state?: string | null;
            postal_code?: string | null;
            primary_domain?: string | null;
          } | null;
        }>;
        pagination?: { total_pages?: number; total_entries?: number };
      } | null;

      const people: ApolloSearchPerson[] = (json?.people ?? [])
        .filter((p) => p.id)
        .map((p) => ({
          id: p.id as string,
          firstName: p.first_name ?? null,
          // Apollo returns the unrevealed surname already masked; store what it
          // gave us rather than inventing a full name we do not have.
          lastNameObfuscated: p.last_name ?? null,
          title: p.title ?? null,
          linkedinUrl: p.linkedin_url ?? null,
          organization: p.organization
            ? {
                id: p.organization.id ?? null,
                name: p.organization.name ?? null,
                city: p.organization.city ?? null,
                state: p.organization.state ?? null,
                zip: p.organization.postal_code ?? null,
                domain: p.organization.primary_domain ?? null,
              }
            : null,
        }));

      return {
        people,
        totalPages: json?.pagination?.total_pages ?? 0,
        totalEntries: json?.pagination?.total_entries ?? 0,
      };
    },
    async peopleMatch(personId) {
      // Deterministic single-lead-credit work-email enrichment. Reveal neither
      // personal emails nor phone numbers (a phone reveal costs 8 credits), and pass
      // NO waterfall params — Apollo only cascades to variable-cost partner providers
      // when a waterfall param is present, so omitting them keeps the call to the
      // synchronous work-email return at exactly PEOPLE_MATCH_COST_CREDITS (1).
      // throwOnError: this is the PAID call — a transport/HTTP error must THROW so
      // the adapter treats it as billed (conservative), not as a clean no-match.
      const json = (await apolloFetch(
        "/people/match",
        { method: "POST", body: { id: personId, reveal_personal_emails: false, reveal_phone_number: false } },
        { throwOnError: true },
      )) as
        | { person?: { email?: string | null; name?: string; title?: string } }
        | null;
      const person = json?.person;
      if (!person) return null;
      return { email: person.email ?? null, name: person.name ?? null, title: person.title ?? null };
    },
  };
}
