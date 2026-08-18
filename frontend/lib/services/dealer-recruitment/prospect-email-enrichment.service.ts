// Y1 — Prospect email acquisition + verification.
//
// Discovery inserts DealerProspect rows with `email: null`; the outreach stage
// filters `email: { not: null }`, so without this step ~zero discovered
// prospects are ever contacted. This service runs a BOUNDED, verify-before-
// persist enrichment pass between discovery and outreach:
//
//   1. Load up to MAX_ENRICH_PER_PASS prospects for this opportunity that have a
//      website, no email, and are not DEAD/ONBOARDED.
//   2. Cross-opportunity dedup: if the same dealership (by normalized website
//      host, or name+zip fallback) has ALREADY been contacted under another
//      opportunity, mark this prospect DUPLICATE and skip — never re-cold-email.
//   3. Otherwise run enrichDealerEmail in read-only (persist:false) mode.
//   4. Persist the contact block always; persist the EMAIL only when it is not
//      hard-suppressed AND its domain has a live MX record (deliverable).
//
// It reuses the EXISTING enrichDealerEmail (Gemini Search grounding) — it does
// NOT add a new provider adapter — and never fabricates or persists an
// unverified / suppressed / duplicate email. Idempotent: a re-drive re-selects
// only `email: null` prospects and the enrichDealerEmail recency guard also
// holds. Per-prospect try/catch keeps one failure from aborting the batch.

import { logger } from "@/lib/logger";
import type { Prisma, PrismaClient, DealerProspectStatus } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { SuppressionService } from "@/lib/services/suppression.service";
import { verifyEmailDeliverability } from "@/lib/services/integrations/email-deliverability.service";
import { enrichDealerEmail } from "./email-enrichment.service";

// Bounded per pass so a single intake never fans out an unbounded number of
// Gemini + DNS calls (each enrichDealerEmail call is a grounded LLM request).
export const MAX_ENRICH_PER_PASS = 10;

// Statuses that mean "this dealership has already been contacted".
const CONTACTED_STATUSES: DealerProspectStatus[] = ["CONTACTED", "REPLIED", "ONBOARDED"];
const CONTACTED_LOG_STATUSES: string[] = ["queued", "sent", "delivered"];

export interface ProspectEnrichmentDeps {
  prisma: PrismaClient;
  supabase: SupabaseClient;
  enrich: typeof enrichDealerEmail;
  verifyDeliverability: typeof verifyEmailDeliverability;
  isEmailHardSuppressed: typeof SuppressionService.isEmailHardSuppressed;
}

export interface ProspectEnrichmentCounts {
  processed: number;
  verified: number;
  duplicate: number;
  unverified: number;
  suppressed: number;
  /** Transient enrichment-provider failures — left untouched for a later retry. */
  errored: number;
}

// Normalize a website into a bare host key: strip protocol, `www.`, path,
// query/fragment, and trailing slash; lowercase. Returns null when nothing
// usable remains.
export function normalizeWebsiteHost(website?: string | null): string | null {
  if (!website) return null;
  let h = website.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^https?:\/\//, "");
  h = h.replace(/^www\./, "");
  h = h.split("/")[0];
  h = h.split("?")[0].split("#")[0];
  h = h.replace(/\/+$/, "");
  return h || null;
}

// name+zip fallback key when a host can't be derived.
function nameZipKey(name?: string | null, zip?: string | null): string | null {
  const n = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const z = (zip ?? "").trim();
  if (!n || !z) return null;
  return `${n}|${z}`;
}

type CandidateRow = {
  id: string;
  name: string | null;
  website: string | null;
  zip: string | null;
};

type LoadedProspect = {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  website: string | null;
};

/**
 * Has ANY OTHER DealerProspect representing the same dealership already been
 * contacted? SQL can't normalize the host, so we fetch a bounded candidate set
 * with a cheap `contains` (or zip) filter and compare normalized keys in JS.
 */
async function hasContactedDuplicate(
  prisma: PrismaClient,
  prospect: LoadedProspect,
): Promise<boolean> {
  const host = normalizeWebsiteHost(prospect.website);
  const contactedFilter = {
    OR: [
      { status: { in: CONTACTED_STATUSES } },
      { outreachLog: { some: { status: { in: CONTACTED_LOG_STATUSES } } } },
    ],
  };

  if (host) {
    const candidates = (await prisma.dealerProspect.findMany({
      where: {
        id: { not: prospect.id },
        email: { not: null },
        website: { contains: host, mode: "insensitive" },
        ...contactedFilter,
      },
      select: { id: true, name: true, website: true, zip: true },
      take: 50,
    })) as CandidateRow[];
    return candidates.some((c) => normalizeWebsiteHost(c.website) === host);
  }

  // Fallback: name + zip. (Loaded prospects always have a website, so this is a
  // safety net rather than a common path.)
  const key = nameZipKey(prospect.name, prospect.zip);
  if (!key || !prospect.zip) return false;
  const candidates = (await prisma.dealerProspect.findMany({
    where: {
      id: { not: prospect.id },
      email: { not: null },
      zip: prospect.zip,
      ...contactedFilter,
    },
    select: { id: true, name: true, website: true, zip: true },
    take: 50,
  })) as CandidateRow[];
  return candidates.some((c) => nameZipKey(c.name, c.zip) === key);
}

/**
 * Enrich discovered prospects for one opportunity with a VERIFIED business
 * email. Bounded, idempotent, per-prospect isolated. All effects injectable for
 * tests; defaults use the real prisma / suppression / deliverability / Gemini.
 */
export async function enrichProspectEmailsForOpportunity(
  buyerOpportunityId: string,
  deps?: Partial<ProspectEnrichmentDeps>,
): Promise<ProspectEnrichmentCounts> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const enrich = deps?.enrich ?? enrichDealerEmail;
  const verifyDeliverability = deps?.verifyDeliverability ?? verifyEmailDeliverability;
  const isEmailHardSuppressed =
    deps?.isEmailHardSuppressed ?? SuppressionService.isEmailHardSuppressed;

  // Supabase is only needed for the hard-suppression check, and importing it
  // eagerly pulls in `server-only` (which throws outside a server bundle), so
  // resolve it lazily and only when we actually have an email to check.
  let supabase = deps?.supabase;
  const getSupabase = async (): Promise<SupabaseClient> => {
    if (!supabase) {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      supabase = getServiceSupabase();
    }
    return supabase;
  };

  const counts: ProspectEnrichmentCounts = {
    processed: 0,
    verified: 0,
    duplicate: 0,
    unverified: 0,
    suppressed: 0,
    errored: 0,
  };

  // Within-batch self-dedup: discovery can emit two rows for the SAME dealership
  // (e.g. sales vs. service on one domain) under one opportunity — neither is
  // "already contacted", so the cross-opportunity check below wouldn't catch
  // them. Track hosts we've already given a verified email to THIS pass so a
  // second same-host prospect is marked DUPLICATE instead of double-cold-emailed.
  const emailedHostsThisPass = new Set<string>();

  const prospects = (await prisma.dealerProspect.findMany({
    where: {
      buyerOppId: buyerOpportunityId,
      website: { not: null },
      email: null,
      status: { notIn: ["DEAD", "ONBOARDED"] },
    },
    orderBy: [{ distanceMiles: "asc" }, { searchScore: "desc" }],
    take: MAX_ENRICH_PER_PASS,
    select: { id: true, name: true, city: true, state: true, zip: true, website: true },
  })) as LoadedProspect[];

  for (const p of prospects) {
    try {
      const host = normalizeWebsiteHost(p.website);

      // (a) Within-batch self-dedup — a same-host prospect already emailed this
      // pass must not be cold-emailed again.
      if (host && emailedHostsThisPass.has(host)) {
        await prisma.dealerProspect.update({
          where: { id: p.id },
          data: { emailVerificationStatus: "DUPLICATE", emailEnrichedAt: new Date() },
        });
        counts.duplicate += 1;
        counts.processed += 1;
        continue;
      }

      // (b) Cross-opportunity dedup — never re-cold-email the same dealership.
      if (await hasContactedDuplicate(prisma, p)) {
        await prisma.dealerProspect.update({
          where: { id: p.id },
          data: { emailVerificationStatus: "DUPLICATE", emailEnrichedAt: new Date() },
        });
        counts.duplicate += 1;
        counts.processed += 1;
        continue;
      }

      // (c) Read-only enrichment (verify-before-persist).
      const result = await enrich({
        dealerProspectId: p.id,
        dealerName: p.name,
        city: p.city ?? "",
        state: p.state ?? "",
        website: p.website,
        persist: false,
      });

      // (d) Transient provider failure — leave the row untouched (email null,
      // emailEnrichedAt unstamped) so a later re-run can retry, rather than
      // recording NONE and burning the 30-day recency window.
      if (result.errored) {
        counts.errored += 1;
        continue;
      }

      // (e) Recency guard short-circuited the call — nothing to do.
      if (result.skipped) continue;

      const now = new Date();
      const data: Prisma.DealerProspectUpdateInput = {
        emailEnrichedAt: now,
        contactEnrichedAt: now,
      };

      // (d) Contact block — a found ISM with no email is still stored.
      if (result.contactName) {
        data.contactName = result.contactName;
        data.contactTitle = result.contactTitle;
        data.contactPhone = result.contactPhone;
        data.contactSource = result.contactSource;
        data.contactConfidence = result.contactConfidence;
        data.contactSourceUrl = result.contactSourceUrl;
      }

      // (e) Email gate — only when a candidate address was found.
      if (result.email) {
        if (await isEmailHardSuppressed(await getSupabase(), result.email)) {
          data.emailVerificationStatus = "SUPPRESSED";
          counts.suppressed += 1;
        } else if (!(await verifyDeliverability(result.email)).deliverable) {
          data.emailVerificationStatus = "UNVERIFIED";
          counts.unverified += 1;
        } else {
          data.email = result.email;
          data.emailSource = result.source;
          data.emailVerifiedAt = now;
          data.emailVerificationStatus = "VERIFIED";
          counts.verified += 1;
          if (host) emailedHostsThisPass.add(host);
        }
      } else {
        data.emailVerificationStatus = "NONE";
      }

      // (f) Persist.
      await prisma.dealerProspect.update({ where: { id: p.id }, data });
      counts.processed += 1;
    } catch (err) {
      // Per-prospect isolation: one failure never aborts the batch, and nothing
      // partial is persisted for the failed prospect.
      logger.error(`[y1] prospect email enrichment failed for ${p.id}:`, err);
    }
  }

  logger.info(
    `[y1] prospect email enrichment for ${buyerOpportunityId}: ` +
      `processed=${counts.processed} verified=${counts.verified} ` +
      `duplicate=${counts.duplicate} unverified=${counts.unverified} ` +
      `suppressed=${counts.suppressed} errored=${counts.errored}`,
  );

  return counts;
}
