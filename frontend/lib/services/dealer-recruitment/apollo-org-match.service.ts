// Phase 1.3 — resolve an Apollo organization to a dealer_rooftops row.
//
// REUSE, NOT REIMPLEMENT. The keys are built by dealerIdentityKeys() from
// dealer-identity.service — the same function that produced the website_host /
// name_zip_key / name_city_state_key / phone_key columns already stored on
// dealer_rooftops. Writing a second normalizer here would compute keys that do
// not agree with the persisted ones, and the match would degrade silently as the
// two drifted apart.
//
// NEVER SILENTLY GUESS. Enrichment spends real credits against whichever rooftop
// this returns, so a wrong link is a wrong charge against the wrong dealership.
// Every outcome therefore records the method that produced it and how much that
// method is worth; an ambiguous match is demoted and flagged rather than taken
// on trust, and an organization with no usable key is reported as unmatchable
// instead of being forced into a junk rooftop.

import { logger } from "@/lib/logger";
import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import {
  dealerIdentityKeys,
  normalizeDealerName,
} from "@/lib/services/dealer/dealer-identity.service";

export type MatchMethod =
  | "website_host"
  | "name_zip"
  | "name_city_state"
  | "phone"
  | "created"
  | "unmatchable";

export type MatchConfidence = "high" | "medium" | "low";

/**
 * Confidence is a property of the METHOD, declared once. Deciding it per call
 * would let the same method report differently in two places, which makes the
 * recorded confidence useless for review. Ambiguity demotes the result to "low"
 * on top of this table; nothing else adjusts it.
 */
export const MATCH_METHOD_CONFIDENCE: Record<MatchMethod, MatchConfidence> = {
  website_host: "high", // a shared real domain is the strongest evidence available
  name_zip: "high", // same normalized name in the same ZIP
  name_city_state: "medium", // a city can hold two rooftops of one brand
  phone: "medium", // groups share switchboards, so this can over-match
  created: "low", // nothing matched; this is an assertion, not a confirmation
  unmatchable: "low", // no usable key at all
};

export interface ApolloOrgInput {
  name: string | null;
  domain: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
}

/** The subset of dealer_rooftops matching needs. */
export interface RooftopRow {
  id: string;
  displayName: string;
  websiteHost: string | null;
  nameZipKey: string | null;
  nameCityStateKey: string | null;
  phoneKey: string | null;
}

export interface OrgMatchResult {
  rooftopId: string | null;
  method: MatchMethod;
  confidence: MatchConfidence;
  created: boolean;
  /** True when more than one rooftop matched on the winning key. */
  ambiguous: boolean;
  /** How many rooftops matched on the winning key. */
  candidateCount: number;
}

export interface CreateRooftopInput {
  displayName: string;
  nameKey: string;
  websiteHost: string | null;
  nameZipKey: string | null;
  nameCityStateKey: string | null;
  phoneKey: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

export interface OrgMatchDeps {
  prisma: PrismaClient;
  findRooftops: (keys: {
    host: string | null;
    nameZip: string | null;
    nameCityState: string | null;
    phone: string | null;
  }) => Promise<RooftopRow[]>;
  createRooftop: (input: CreateRooftopInput) => Promise<{ id: string }>;
}

/** Candidate rooftops matching ANY of the supplied keys, in one query. */
async function defaultFindRooftops(
  keys: { host: string | null; nameZip: string | null; nameCityState: string | null; phone: string | null },
  prisma: PrismaClient,
): Promise<RooftopRow[]> {
  const or: Prisma.DealerRooftopWhereInput[] = [];
  if (keys.host) or.push({ websiteHost: keys.host });
  if (keys.nameZip) or.push({ nameZipKey: keys.nameZip });
  if (keys.nameCityState) or.push({ nameCityStateKey: keys.nameCityState });
  if (keys.phone) or.push({ phoneKey: keys.phone });
  if (or.length === 0) return [];
  return prisma.dealerRooftop.findMany({
    where: { OR: or },
    select: {
      id: true,
      displayName: true,
      websiteHost: true,
      nameZipKey: true,
      nameCityStateKey: true,
      phoneKey: true,
    },
  });
}

async function defaultCreateRooftop(
  input: CreateRooftopInput,
  prisma: PrismaClient,
): Promise<{ id: string }> {
  return prisma.dealerRooftop.create({ data: input, select: { id: true } });
}

/**
 * Resolve one Apollo organization to a rooftop, creating one when nothing
 * matches. Keys are tried strongest-first and the first key with any hit wins —
 * a weaker key is never consulted once a stronger one has matched.
 */
export async function matchApolloOrgToRooftop(
  org: ApolloOrgInput,
  deps?: Partial<OrgMatchDeps>,
): Promise<OrgMatchResult> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const findRooftops = deps?.findRooftops ?? ((k) => defaultFindRooftops(k, prisma));
  const createRooftop = deps?.createRooftop ?? ((i) => defaultCreateRooftop(i, prisma));

  const keys = dealerIdentityKeys({
    name: org.name,
    website: org.domain,
    zip: org.zip,
    city: org.city,
    state: org.state,
    phone: org.phone,
  });

  // No usable key means no defensible link AND no defensible new rooftop. Report
  // it; a junk rooftop would pollute every future match against this table.
  if (!keys.host && !keys.nameZip && !keys.nameCityState && !keys.phone) {
    logger.warn(`[apollo-match] organization has no usable identity key: ${org.name ?? "(unnamed)"}`);
    return {
      rooftopId: null,
      method: "unmatchable",
      confidence: MATCH_METHOD_CONFIDENCE.unmatchable,
      created: false,
      ambiguous: false,
      candidateCount: 0,
    };
  }

  const rooftops = await findRooftops(keys);

  // Strongest-first. Each entry is [method, the rooftops matching that key].
  const tiers: Array<[MatchMethod, RooftopRow[]]> = [
    ["website_host", keys.host ? rooftops.filter((r) => r.websiteHost === keys.host) : []],
    ["name_zip", keys.nameZip ? rooftops.filter((r) => r.nameZipKey === keys.nameZip) : []],
    [
      "name_city_state",
      keys.nameCityState ? rooftops.filter((r) => r.nameCityStateKey === keys.nameCityState) : [],
    ],
    ["phone", keys.phone ? rooftops.filter((r) => r.phoneKey === keys.phone) : []],
  ];

  for (const [method, matches] of tiers) {
    if (matches.length === 0) continue;
    // Ties break on lowest id so the same input always resolves the same way —
    // a re-run must not silently move a person to a different rooftop.
    const chosen = [...matches].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
    const ambiguous = matches.length > 1;
    if (ambiguous) {
      logger.warn(
        `[apollo-match] ${matches.length} rooftops share ${method} for "${org.name}" — ` +
          `linked ${chosen.id} at LOW confidence for review`,
      );
    }
    return {
      rooftopId: chosen.id,
      method,
      // Ambiguity overrides the method's declared confidence. It is still a
      // lead, but it must be findable as one that was a coin flip.
      confidence: ambiguous ? "low" : MATCH_METHOD_CONFIDENCE[method],
      created: false,
      ambiguous,
      candidateCount: matches.length,
    };
  }

  // Nothing matched. Create the rooftop WITH its keys, so the next organization
  // that resolves to the same dealership matches this row instead of creating a
  // duplicate.
  const nameKey = normalizeDealerName(org.name);
  if (!nameKey) {
    // Unreachable given the key check above, but a rooftop with no name_key
    // would be unmatchable forever, so it is refused rather than written.
    return {
      rooftopId: null,
      method: "unmatchable",
      confidence: MATCH_METHOD_CONFIDENCE.unmatchable,
      created: false,
      ambiguous: false,
      candidateCount: 0,
    };
  }

  const createdRooftop = await createRooftop({
    displayName: org.name ?? nameKey,
    nameKey,
    websiteHost: keys.host,
    nameZipKey: keys.nameZip,
    nameCityStateKey: keys.nameCityState,
    phoneKey: keys.phone,
    city: org.city,
    state: org.state,
    zip: org.zip,
  });

  return {
    rooftopId: createdRooftop.id,
    method: "created",
    confidence: MATCH_METHOD_CONFIDENCE.created,
    created: true,
    ambiguous: false,
    candidateCount: 0,
  };
}
