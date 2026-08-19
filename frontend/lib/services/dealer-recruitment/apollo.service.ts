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

// The seam the orchestration depends on — injectable so the 3-stage logic is
// unit-tested without live HTTP.
export interface ApolloClient {
  organizationsLookup(input: { name: string; domain?: string | null }): Promise<ApolloOrg | null>;
  peopleSearch(input: { organizationId: string; titles: readonly string[] }): Promise<ApolloPerson[]>;
  peopleMatch(personId: string): Promise<ApolloRevealed | null>; // the paid reveal
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
 * Resolve a dealer to a revealed internet-sales contact. Returns null on ANY
 * failure (fail-closed). Callers MUST have already drawn a credit — the reveal
 * (stage 3) is the paid call.
 */
export async function apolloResolveAndReveal(
  input: ApolloAdapterInput,
  deps?: Partial<ApolloAdapterDeps>,
): Promise<ApolloRevealed | null> {
  const client = deps?.client ?? defaultApolloClient();
  if (!client) return null; // no key / disabled → fail closed

  try {
    // Stage 1 — canonical org (never trust a raw domain alone).
    const org = await client.organizationsLookup({
      name: input.name,
      domain: normalizeWebsiteHost(input.website),
    });
    if (!org) return null;

    // Stage 2 — people by org + ranked titles; among the flag-positive people,
    // pick the best-title-ranked (Apollo doesn't guarantee title order, so we rank
    // on our side rather than trusting the returned order).
    const people = await client.peopleSearch({ organizationId: org.id, titles: APOLLO_SALES_TITLES });
    const withEmail = people.filter((p) => p.hasEmail);
    if (withEmail.length === 0) return null;
    const target = withEmail.reduce((best, p) => (titleRank(p.title) < titleRank(best.title) ? p : best));

    // Stage 3 — reveal ONLY the chosen person (the credit-spending call).
    const revealed = await client.peopleMatch(target.id);
    if (!revealed?.email) return null;
    return revealed;
  } catch (err) {
    logger.warn(`[apollo] resolveAndReveal failed for "${input.name}":`, err);
    return null;
  }
}

// ─── default live client (isolated; verified in staging) ─────────────────────

async function apolloFetch(path: string, body: Record<string, unknown>): Promise<unknown | null> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return null; // fail closed — never call without a key
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
      return null;
    }
    return await res.json();
  } catch (err) {
    logger.warn(`[apollo] request failed on ${path}:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Real Apollo client, or null when unconfigured/disabled (tier stays off). */
export function defaultApolloClient(): ApolloClient | null {
  if (!apolloEnabled()) return null;
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
    async peopleMatch(personId) {
      const json = (await apolloFetch("/people/match", { id: personId, reveal_personal_emails: false })) as
        | { person?: { email?: string | null; name?: string; title?: string } }
        | null;
      const person = json?.person;
      if (!person) return null;
      return { email: person.email ?? null, name: person.name ?? null, title: person.title ?? null };
    },
  };
}
