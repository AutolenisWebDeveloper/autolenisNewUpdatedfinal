// Block A / A2 — DealerRooftop resolver (cross-pool dedup + read-only make signal).
//
// Resolves a registered Dealer or a DealerProspect to its canonical physical
// rooftop using the ONE shared matching strategy (dealer-identity.service), links
// the candidate (rooftopId), and recomputes the rooftop's read-only `makes`
// signal — authoritative from DealerCapacityConfig.preferredMakes for registered
// dealers, falling back to prospect brand. The rooftop NEVER writes
// preferredMakes. Registered dealers win: whenever any registered dealer is
// linked, its preferredMakes define the signal.
//
// All effects injectable so unit tests never touch prisma. Idempotent: re-running
// re-resolves to the same rooftop and re-links (no duplicate rows).

import { logger } from "@/lib/logger";
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { getPreferredMakes as defaultGetPreferredMakes } from "@/lib/services/auction/auction-capacity.service";
import { dealerIdentityKeys, normalizeDealerName } from "./dealer-identity.service";

export interface RooftopCandidate {
  kind: "dealer" | "prospect";
  id: string;
  name: string;
  website?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  phone?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

export interface RooftopDeps {
  prisma: PrismaClient;
  getPreferredMakes: (dealerId: string) => Promise<string[]>;
}

export type MakesSource = "preferred_makes" | "prospect_brand" | null;

function dedupe(values: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const t = (v ?? "").trim();
    if (t && !seen.has(t.toLowerCase())) {
      seen.add(t.toLowerCase());
      out.push(t);
    }
  }
  return out;
}

/**
 * Recompute a rooftop's make signal. Registered dealers are authoritative: if any
 * linked Dealer has preferredMakes, the union of those wins. Otherwise fall back
 * to the union of linked prospects' `brand`. Never writes preferredMakes.
 */
export async function computeRooftopMakes(
  rooftopId: string,
  deps?: Partial<RooftopDeps>,
): Promise<{ makes: string[]; source: MakesSource }> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const getPreferredMakes = deps?.getPreferredMakes ?? defaultGetPreferredMakes;

  const dealers = await prisma.dealer.findMany({ where: { rooftopId }, select: { id: true } });
  const dealerMakeLists = await Promise.all(dealers.map((d) => getPreferredMakes(d.id)));
  const dealerMakes = dedupe(dealerMakeLists.flat());
  if (dealerMakes.length > 0) return { makes: dealerMakes, source: "preferred_makes" };

  const prospects = await prisma.dealerProspect.findMany({
    where: { rooftopId },
    select: { brand: true },
  });
  const brandMakes = dedupe(prospects.map((p) => p.brand));
  if (brandMakes.length > 0) return { makes: brandMakes, source: "prospect_brand" };

  return { makes: [], source: null };
}

/**
 * Resolve a candidate to its canonical rooftop, link it, and refresh the rooftop.
 * Returns the rooftop id, or null when the candidate has no usable name (a
 * rooftop needs at least a normalized name key).
 */
export async function resolveRooftop(
  candidate: RooftopCandidate,
  deps?: Partial<RooftopDeps>,
): Promise<string | null> {
  const prisma = deps?.prisma ?? defaultPrisma;

  const nameKey = normalizeDealerName(candidate.name);
  if (!nameKey) {
    logger.warn(`[rooftop] cannot resolve ${candidate.kind} ${candidate.id} — no usable name`);
    return null;
  }
  const keys = dealerIdentityKeys(candidate);

  // Matching tiers (dedup-skill: auto-merge only high-confidence; possible →
  // never auto-merge). STRONG (auto-link): website host, name+zip. WEAK/possible
  // (observe, never merge): name+city+state (collapses a group's same-name lots)
  // and phone (shared switchboards). Auto-merging on weak keys would wrongly
  // collapse distinct rooftops, so those only surface a review signal.
  const strongOr: Array<{ websiteHost: string } | { nameZipKey: string }> = [];
  if (keys.host) strongOr.push({ websiteHost: keys.host });
  if (keys.nameZip) strongOr.push({ nameZipKey: keys.nameZip });

  let rooftop: Awaited<ReturnType<typeof prisma.dealerRooftop.findFirst>> = null;
  if (strongOr.length) {
    const matches = await prisma.dealerRooftop.findMany({ where: { OR: strongOr }, take: 2 });
    // Host-conflict veto: a strong (name+zip) match whose host DISAGREES with the
    // candidate's host is not the same dealership — drop it rather than false-merge.
    const viable = matches.filter(
      (m) => !(keys.host && m.websiteHost && m.websiteHost !== keys.host),
    );
    if (viable.length > 1) {
      logger.warn(
        `[rooftop] ambiguous strong match for ${candidate.kind} ${candidate.id} ` +
          `(${viable.length} rooftops) — binding to the host match / first, not merging the rest`,
      );
    }
    // Prefer an exact host match; else the first viable.
    rooftop = viable.find((m) => keys.host && m.websiteHost === keys.host) ?? viable[0] ?? null;
  }

  if (!rooftop) {
    // No strong match. Surface (do NOT merge) a weak/possible duplicate so it's
    // observable for the review queue, then create a distinct rooftop.
    const weakOr: Array<{ nameCityStateKey: string } | { phoneKey: string }> = [];
    if (keys.nameCityState) weakOr.push({ nameCityStateKey: keys.nameCityState });
    if (keys.phone) weakOr.push({ phoneKey: keys.phone });
    if (weakOr.length) {
      const possible = await prisma.dealerRooftop.findFirst({ where: { OR: weakOr } });
      if (possible) {
        logger.info(
          `[rooftop] possible duplicate NOT auto-merged: ${candidate.kind} ${candidate.id} ` +
            `~ rooftop ${possible.id} (weak-key match) — distinct rooftop created`,
        );
      }
    }
    try {
      rooftop = await prisma.dealerRooftop.create({
        data: {
          displayName: candidate.name.trim(),
          nameKey,
          websiteHost: keys.host,
          phoneKey: keys.phone,
          nameZipKey: keys.nameZip,
          nameCityStateKey: keys.nameCityState,
          zip: candidate.zip ?? null,
          city: candidate.city ?? null,
          state: candidate.state ?? null,
          latitude: candidate.latitude ?? null,
          longitude: candidate.longitude ?? null,
        },
      });
    } catch (err) {
      // Only a unique-constraint race (P2002 on websiteHost) is recoverable:
      // another resolver created the rooftop first — re-find by host. Any other
      // error propagates rather than being masked.
      const code = (err as { code?: string })?.code;
      if (code === "P2002" && keys.host) {
        rooftop = await prisma.dealerRooftop.findFirst({ where: { websiteHost: keys.host } });
      }
      if (!rooftop) throw err;
    }
  }

  // Link the candidate to the rooftop.
  if (candidate.kind === "dealer") {
    await prisma.dealer.update({ where: { id: candidate.id }, data: { rooftopId: rooftop.id } });
  } else {
    await prisma.dealerProspect.update({ where: { id: candidate.id }, data: { rooftopId: rooftop.id } });
  }

  // Backfill any identity keys / coordinates the existing rooftop was missing, so
  // future lookups on those keys hit. Never overwrites a value already present.
  const patch: Record<string, unknown> = {};
  if (!rooftop.websiteHost && keys.host) patch.websiteHost = keys.host;
  if (!rooftop.phoneKey && keys.phone) patch.phoneKey = keys.phone;
  if (!rooftop.nameZipKey && keys.nameZip) patch.nameZipKey = keys.nameZip;
  if (!rooftop.nameCityStateKey && keys.nameCityState) patch.nameCityStateKey = keys.nameCityState;
  if (rooftop.latitude == null && candidate.latitude != null) patch.latitude = candidate.latitude;
  if (rooftop.longitude == null && candidate.longitude != null) patch.longitude = candidate.longitude;
  if (!rooftop.zip && candidate.zip) patch.zip = candidate.zip;
  if (!rooftop.city && candidate.city) patch.city = candidate.city;
  if (!rooftop.state && candidate.state) patch.state = candidate.state;

  // Recompute the read-only make signal (registered dealers win).
  const { makes, source } = await computeRooftopMakes(rooftop.id, deps);
  patch.makes = makes;
  patch.makesSource = source;

  await prisma.dealerRooftop.update({ where: { id: rooftop.id }, data: patch });
  return rooftop.id;
}
