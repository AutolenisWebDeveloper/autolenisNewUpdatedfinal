// Block B / Apollo — dealer internet-sales contact reveal adapter.
//
// Fail-closed 3-stage shape proven by the live coverage probe:
//   1. resolve the dealer → canonical Apollo ORG (by name + domain/location) —
//      a guessed domain silently returns 0 for real dealers, so we resolve the
//      org first.
//   2. people-search by organization_id + ranked sales titles; read the free
//      pre-reveal has_email flag and take the best flag-positive person.
//   3. reveal (people/match) ONLY that person — the single credit-spending call.
//
// Nothing here spends a credit on its own: the credit ledger draw happens in
// apollo-reveal.service BEFORE the reveal call. This module only talks to Apollo,
// and FAILS CLOSED everywhere (missing key / no entitlement / no credits / API
// error / no hit → null; never throws into the waterfall, never fabricates).
//
// The live HTTP client is isolated in defaultApolloClient (verified in staging —
// this session's egress to api.apollo.io is policy-blocked). The orchestration is
// unit-tested by injecting a fake ApolloClient.

import { logger } from "@/lib/logger";
import { normalizeWebsiteHost } from "@/lib/services/dealer/dealer-identity.service";

const APOLLO_BASE_URL = (process.env.APOLLO_BASE_URL ?? "https://api.apollo.io/api/v1").replace(/\/$/, "");
const APOLLO_TIMEOUT_MS = 12_000;

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
// The 3-stage reveal above starts from organizations/lookup, which needs the
// dealer's domain. Website coverage across dealer_prospects is 133/1,532, so
// that path cannot reach ~91% of the list. People Search keys on SIC code +
// title + location instead and needs no domain, which makes it the primary way
// candidates enter the system.
//
// Searching costs NOTHING — only reveal/enrichment draws a credit. Nothing in
// this section may call a billable endpoint.

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

// Outcome of a reveal attempt, carrying whether Apollo was (or may have been)
// BILLED so the ledger only refunds a genuinely free no-op. Apollo charges a lead
// credit when people/match MATCHES a person, even if it unlocks no email — so a
// matched-but-emailless reveal is `billed:true` (do NOT refund; never undercount
// spend / overspend the cap). A no-op that never reached a billable call (no org /
// no people / no person matched) is `billed:false` (refund).
export type ApolloRevealOutcome =
  | { kind: "revealed"; email: string; name: string | null; title: string | null }
  | { kind: "empty"; billed: boolean };

// The seam the orchestration depends on — injectable so the 3-stage logic is
// unit-tested without live HTTP.
export interface ApolloClient {
  organizationsLookup(input: { name: string; domain?: string | null }): Promise<ApolloOrg | null>;
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
 * Returns an ApolloRevealOutcome: `revealed` with the email, or `empty` carrying
 * whether Apollo was billed (so the ledger refunds only a genuinely free no-op).
 * Callers MUST have already drawn a credit — stage 3 (people/match) is the paid call.
 */
export async function apolloResolveAndReveal(
  input: ApolloAdapterInput,
  deps?: Partial<ApolloAdapterDeps>,
): Promise<ApolloRevealOutcome> {
  const client = deps?.client ?? defaultApolloClient();
  if (!client) return { kind: "empty", billed: false }; // no key / disabled → fail closed, not billed

  // Stages 1–2 are FREE (org lookup + people search). A failure here is never billed.
  let target: ApolloPerson;
  try {
    // Stage 1 — canonical org (never trust a raw domain alone).
    const org = await client.organizationsLookup({
      name: input.name,
      domain: normalizeWebsiteHost(input.website),
    });
    if (!org) return { kind: "empty", billed: false };

    // Stage 2 — people by org + ranked titles; pick the BEST-TITLE-ranked person
    // and reveal that one. Selection is title-first and does NOT gate on the
    // has_email flag: on some Apollo plans People Search returns has_email:false
    // for real, revealable contacts (confirmed live — a genuine sales manager came
    // back has_email:false), so gating on the flag would filter everyone out and
    // the tier would silently reveal nothing. We accept that some reveals come back
    // empty. The flag is used only as a tiebreaker among equal titles.
    const people = await client.peopleSearch({ organizationId: org.id, titles: APOLLO_SALES_TITLES });
    if (people.length === 0) return { kind: "empty", billed: false };
    target = [...people].sort((a, b) => {
      const byTitle = titleRank(a.title) - titleRank(b.title);
      if (byTitle !== 0) return byTitle;
      return (b.hasEmail ? 1 : 0) - (a.hasEmail ? 1 : 0); // tie → prefer a flagged email
    })[0];
  } catch (err) {
    logger.warn(`[apollo] resolve (free stages) failed for "${input.name}":`, err);
    return { kind: "empty", billed: false }; // never reached the paid call → not billed
  }

  // Stage 3 — the PAID people/match. Apollo charges a lead credit when it matches a
  // person (email or not), so anything other than a clean "no person matched" is
  // treated as billed → the ledger keeps the credit (conservative: never undercount).
  try {
    const revealed = await client.peopleMatch(target.id);
    if (revealed === null) return { kind: "empty", billed: false }; // no person matched → not billed
    if (!revealed.email) return { kind: "empty", billed: true }; // matched, no email → billed
    return { kind: "revealed", email: revealed.email, name: revealed.name ?? null, title: revealed.title ?? null };
  } catch (err) {
    // The billable call errored — we cannot know whether Apollo charged, so assume
    // it did (never undercount). Ledger keeps the credit; the cycle claim goes EMPTY.
    logger.warn(`[apollo] people/match failed for "${input.name}":`, err);
    return { kind: "empty", billed: true };
  }
}

// ─── default live client (isolated; verified in staging) ─────────────────────

// throwOnError distinguishes the FREE stages (org lookup / people search) from the
// PAID people/match call. Free stages fail closed to null (a transport error there
// costs nothing, so treating it as "no result" is safe). The paid call passes
// throwOnError:true so an HTTP/timeout/network error THROWS instead of collapsing
// to null — otherwise the adapter couldn't tell an error (Apollo may have charged)
// from a clean 200 "no person matched" (not charged), and would wrongly refund a
// real charge, undercounting spend and breaking the conservative-billing invariant.
async function apolloFetch(
  path: string,
  body: Record<string, unknown>,
  opts?: { throwOnError?: boolean },
): Promise<unknown | null> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) {
    if (opts?.throwOnError) throw new Error(`[apollo] missing API key on ${path}`);
    return null; // fail closed — never call without a key
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), APOLLO_TIMEOUT_MS);
  try {
    const res = await fetch(`${APOLLO_BASE_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": key },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      logger.warn(`[apollo] HTTP ${res.status} on ${path}`);
      if (opts?.throwOnError) throw new Error(`[apollo] HTTP ${res.status} on ${path}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn(`[apollo] request failed on ${path}:`, err);
    if (opts?.throwOnError) throw err instanceof Error ? err : new Error(String(err));
    return null;
  } finally {
    clearTimeout(timer);
  }
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

function buildApolloClient(): ApolloClient & ApolloSearchClient {
  return {
    async organizationsLookup({ name, domain }) {
      const json = (await apolloFetch("/organizations/lookup", {
        q_organization_name: name,
        ...(domain ? { q_organization_domains: domain } : {}),
      })) as { organizations?: Array<{ id?: string; primary_domain?: string }> } | null;
      const org = json?.organizations?.[0];
      return org?.id ? { id: org.id, domain: org.primary_domain ?? null } : null;
    },
    async peopleSearch({ organizationId, titles }) {
      const json = (await apolloFetch("/mixed_people/search", {
        organization_ids: [organizationId],
        person_titles: [...titles],
        include_similar_titles: true,
        page: 1,
        per_page: 10,
      })) as { people?: Array<{ id?: string; name?: string; title?: string; email_status?: string; has_email?: boolean }> } | null;
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
      // cannot have billed, because search does not bill.
      const json = (await apolloFetch("/mixed_people/search", {
        organization_sic_codes: [...sicCodes],
        person_titles: [...titles],
        include_similar_titles: true,
        ...(personLocations?.length ? { person_locations: [...personLocations] } : {}),
        ...(organizationLocations?.length ? { organization_locations: [...organizationLocations] } : {}),
        page,
        per_page: perPage,
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
      // synchronous work-email return at exactly REVEAL_COST_CREDITS (1).
      // throwOnError: this is the PAID call — a transport/HTTP error must THROW so
      // the adapter treats it as billed (conservative), not as a clean no-match.
      const json = (await apolloFetch(
        "/people/match",
        { id: personId, reveal_personal_emails: false, reveal_phone_number: false },
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
