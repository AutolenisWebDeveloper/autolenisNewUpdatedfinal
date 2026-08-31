// Phase 1.2 — Apollo People Search: the 0-credit acquisition path.
//
// WHY THIS IS THE PRIMARY ROUTE. The existing paid path
// (apolloResolveAndReveal) starts at organizations/lookup, which needs the
// dealer's website host. Website coverage across dealer_prospects is 133/1,532,
// so org resolution fails for roughly 91% of the list before a person is ever
// considered. People Search keys on SIC code + decision-maker title + location
// and needs no domain, so it can reach rooftops the domain path cannot.
//
// COST. Searching is free; only reveal/enrichment draws a credit. Nothing here
// touches the credit ledger, and the unit tests assert that a ledger draw is
// never invoked — a discovery path that could spend would make the enrichment
// cap unenforceable at its source.
//
// WHAT IS PERSISTED. Every hit becomes an ApolloPersonCandidate with
// enrichmentStatus "NEW" and NO contact detail. Search returns an obfuscated
// surname, which is expected and is stored as-is rather than discarded or
// guessed at. Rooftop matching (Phase 1.3) and enrichment (Phase 1.4) are
// separate steps that read these rows.

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  apolloPeopleSearchEnabled,
  defaultApolloSearchClient,
  DEALER_PERSON_TITLES,
  DEALER_SIC_CODES,
  type ApolloSearchClient,
  type ApolloSearchPerson,
} from "./apollo.service";

/** Apollo's maximum page size for people search. */
export const SEARCH_PAGE_SIZE = 100;

/**
 * Hard ceiling on pages per run, which a caller CANNOT raise. An unbounded
 * pagination loop against a third-party API is never acceptable even when the
 * endpoint is free: it burns rate limit, and a provider that reports an absurd
 * total_pages would otherwise spin indefinitely.
 */
export const MAX_SEARCH_PAGES = 50;

export interface PeopleSearchInput {
  sicCodes?: readonly string[];
  titles?: readonly string[];
  personLocations?: readonly string[];
  organizationLocations?: readonly string[];
  /** Caller ceiling, clamped to MAX_SEARCH_PAGES. */
  maxPages?: number;
}

export interface PeopleSearchCandidate {
  apolloPersonId: string;
  apolloOrganizationId: string | null;
  firstName: string | null;
  lastNameObfuscated: string | null;
  title: string | null;
  organizationName: string | null;
  organizationCity: string | null;
  organizationState: string | null;
  organizationZip: string | null;
  organizationDomain: string | null;
  linkedinUrl: string | null;
  enrichmentStatus: "NEW";
  searchRunKey: string;
}

export interface PeopleSearchResult {
  skipped: boolean;
  pagesFetched: number;
  persisted: number;
  totalEntries: number;
  searchRunKey: string;
  /** Set when pagination stopped early because a page failed. */
  error?: string;
}

export interface PeopleSearchDeps {
  prisma: PrismaClient;
  client: ApolloSearchClient | null;
  enabled: () => boolean;
  now: Date;
  persistCandidate: (candidate: PeopleSearchCandidate) => Promise<void>;
}

/** Upsert keyed on apolloPersonId so re-running a search is idempotent. */
async function defaultPersistCandidate(
  candidate: PeopleSearchCandidate,
  prisma: PrismaClient,
): Promise<void> {
  const { apolloPersonId, enrichmentStatus, ...rest } = candidate;
  await prisma.apolloPersonCandidate.upsert({
    where: { apolloPersonId },
    // A re-run refreshes the descriptive fields but must NEVER reset
    // enrichmentStatus: a candidate already revealed (or already recorded
    // UNREACHABLE) would otherwise be dragged back to NEW and re-enriched,
    // spending a second credit on a person we have already paid for.
    update: { ...rest },
    create: { apolloPersonId, enrichmentStatus, ...rest },
  });
}

function toCandidate(p: ApolloSearchPerson, searchRunKey: string): PeopleSearchCandidate {
  return {
    apolloPersonId: p.id,
    apolloOrganizationId: p.organization?.id ?? null,
    firstName: p.firstName,
    lastNameObfuscated: p.lastNameObfuscated,
    title: p.title,
    organizationName: p.organization?.name ?? null,
    organizationCity: p.organization?.city ?? null,
    organizationState: p.organization?.state ?? null,
    organizationZip: p.organization?.zip ?? null,
    organizationDomain: p.organization?.domain ?? null,
    linkedinUrl: p.linkedinUrl,
    enrichmentStatus: "NEW",
    searchRunKey,
  };
}

/**
 * Run a People Search and persist every hit as an unenriched candidate.
 *
 * Never throws: a page failure stops pagination and is REPORTED on the result,
 * with everything already persisted left in place. Rolling back earlier pages
 * would discard free, valid data because a later page failed.
 */
export async function runPeopleSearch(
  input: PeopleSearchInput,
  deps?: Partial<PeopleSearchDeps>,
): Promise<PeopleSearchResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const enabled = deps?.enabled ?? apolloPeopleSearchEnabled;
  const now = deps?.now ?? new Date();
  const persist =
    deps?.persistCandidate ?? ((c: PeopleSearchCandidate) => defaultPersistCandidate(c, prisma));

  const searchRunKey = `ps_${now.toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
  const base: PeopleSearchResult = {
    skipped: false,
    pagesFetched: 0,
    persisted: 0,
    totalEntries: 0,
    searchRunKey,
  };

  if (!enabled()) {
    logger.info("[apollo-search] APOLLO_PEOPLE_SEARCH_ENABLED is not true — skipping");
    return { ...base, skipped: true };
  }

  const client = deps?.client ?? defaultApolloSearchClient();
  if (!client) {
    logger.info("[apollo-search] no Apollo search client (missing key) — skipping");
    return { ...base, skipped: true };
  }

  const criteria = {
    sicCodes: input.sicCodes ?? DEALER_SIC_CODES,
    titles: input.titles ?? DEALER_PERSON_TITLES,
    personLocations: input.personLocations,
    organizationLocations: input.organizationLocations,
    perPage: SEARCH_PAGE_SIZE,
  };

  const ceiling = Math.min(
    Math.max(1, Math.floor(input.maxPages ?? MAX_SEARCH_PAGES)),
    MAX_SEARCH_PAGES,
  );

  let pagesFetched = 0;
  let persisted = 0;
  let totalEntries = 0;

  for (let page = 1; page <= ceiling; page++) {
    let result: Awaited<ReturnType<ApolloSearchClient["peopleSearchByCriteria"]>>;
    try {
      result = await client.peopleSearchByCriteria({ ...criteria, page });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[apollo-search] page ${page} failed: ${message}`);
      // Keep what earlier pages produced — it is valid, free data.
      return { ...base, pagesFetched, persisted, totalEntries, error: message };
    }

    pagesFetched += 1;
    totalEntries = result.totalEntries || totalEntries;

    for (const person of result.people) {
      try {
        await persist(toCandidate(person, searchRunKey));
        persisted += 1;
      } catch (err) {
        // One bad row must not abort a page of good ones.
        logger.warn(`[apollo-search] persist failed for person ${person.id}:`, err);
      }
    }

    // An empty page means the result set is exhausted, whatever total_pages
    // claimed. Trusting the provider's count alone would keep requesting pages
    // that can never return anything.
    if (result.people.length === 0) break;
    if (result.totalPages > 0 && page >= result.totalPages) break;
  }

  logger.info(
    `[apollo-search] run ${searchRunKey}: ${pagesFetched} page(s), ${persisted} candidate(s) persisted`,
  );
  return { ...base, pagesFetched, persisted, totalEntries };
}
