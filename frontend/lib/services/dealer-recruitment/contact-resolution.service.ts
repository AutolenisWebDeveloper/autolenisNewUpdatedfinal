// Block A / A3 — contactable resolution (FREE tiers).
//
// Determines whether a prospect can actually be cold-contacted, running only the
// cheap tiers (no paid Apollo — that's Block B). LOAD-BEARING INVARIANT:
// "contactable == send-safe" — a candidate is contactable ONLY if its resolved
// address is MX-deliverable AND not hard-suppressed (i.e. Block C could actually
// send to it). Coverage counts nothing this function wouldn't clear for sending,
// so a deposit is never charged into an auction we can't populate.
//
// Waterfall (cheap-first, stop at first send-safe tier):
//   1. reuse       — an already-VERIFIED / ROLE_DERIVED address (re-checked send-safe)
//   2. role-derive — internetsales@{host}, confirmed by the host's MX + suppression.
//                    Persisted as ROLE_DERIVED (inferred provenance) — NEVER VERIFIED.
//   3. Gemini      — Y1 enrichDealerEmail(persist:false); a found person email that
//                    is send-safe persists as VERIFIED (recency guard makes this a
//                    near-no-op when intake already ran it).
//
// All effects injectable; suppression's Supabase client is resolved lazily.

import { logger } from "@/lib/logger";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { SuppressionService } from "@/lib/services/suppression.service";
import { verifyEmailDeliverability } from "@/lib/services/integrations/email-deliverability.service";
import { normalizeWebsiteHost } from "@/lib/services/dealer/dealer-identity.service";
import { getRooftopContacts, upsertContactProfile } from "@/lib/services/dealer/dealer-contact-profile.service";
import { revealRooftopContact } from "./apollo-reveal.service";
import { enrichDealerEmail } from "./email-enrichment.service";

// The emailVerificationStatus values that mean "has a send-safe address" —
// contactable for coverage + eligible for Block C mint. The invariant is
// literally "contactable == send-safe", so the constant is named for it.
export const SEND_SAFE_STATUSES = ["VERIFIED", "ROLE_DERIVED"] as const;

// Ranked role-inbox dictionary, best-first. Role-derivation walks this in order
// and returns the FIRST send-safe address (one address). MX is domain-level, so
// every prefix on a live domain is MX-deliverable — the differentiator is
// suppression: a role inbox that has hard-bounced is suppressed, so the walk-down
// skips it and tries the next-ranked prefix (Block B bounce→re-resolve within the
// role tier). The chosen prefix's address is what gets stored.
export const ROLE_PREFIXES = [
  "internetsales",
  "internet",
  "sales",
  "bdc",
  "fleet",
] as const;

// A reused contact older than this gets a fresh MX re-check before it is trusted;
// a fresher one is reused on the suppression check alone (cheap-first — bounces
// still demote via suppression, and the send path re-verifies MX at send time).
export const CONTACT_STALE_MONTHS = 6;
const CONTACT_STALE_MS = CONTACT_STALE_MONTHS * 30 * 24 * 60 * 60 * 1000;

function isContactStale(verifiedAt: Date | null | undefined, now: Date): boolean {
  if (!verifiedAt) return true; // unknown freshness → treat as stale (re-check MX)
  return now.getTime() - verifiedAt.getTime() > CONTACT_STALE_MS;
}

export interface ContactCandidate {
  id: string;
  name: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  email?: string | null;
  emailVerificationStatus?: string | null;
  // When set, the reuse tier skips the MX re-check for a fresh contact (younger
  // than CONTACT_STALE_MONTHS) and re-checks only when stale. Absent → treated as
  // stale, so callers that don't supply it keep the always-re-check behavior.
  emailVerifiedAt?: Date | null;
  // When set, the waterfall first tries a contact already resolved for this
  // rooftop's twin (registered dealer ↔ prospect share one DealerContactProfile),
  // and writes any newly-resolved contact back to it.
  rooftopId?: string | null;
  // Gate for the PAID Apollo tier (tier 4). Defaults false — the pre-deposit
  // coverage / Y2 path never sets it, so a paid reveal can only fire when a
  // caller (post-deposit, dealer selected for a live auction) opts in.
  allowPaid?: boolean;
}

export type ContactStatus = "VERIFIED" | "ROLE_DERIVED";

export interface ResolvedContact {
  contactable: boolean;
  email?: string;
  status?: ContactStatus;
  source?: string | null;
}

export interface ContactResolutionDeps {
  prisma: PrismaClient;
  supabase: SupabaseClient;
  // MUST match what the actual send path gates on. dealer-email-send's isSuppressed
  // uses SuppressionService.isEmailSuppressed (FULL — bounced/complained/spam-trap
  // AND unsubscribed/admin_added), so "contactable == send-safe" requires the SAME
  // full check here, not just the hard tier — else a soft-suppressed address would
  // be counted contactable and then blocked at send (an empty-auction footgun).
  isEmailSuppressed: typeof SuppressionService.isEmailSuppressed;
  verifyDeliverability: typeof verifyEmailDeliverability;
  enrich: typeof enrichDealerEmail;
  // Rooftop-shared contact identity (B1/B2c). Reuse a contact already resolved
  // for the rooftop's twin; write newly-resolved contacts back. Both fail-open.
  getRooftopContacts: typeof getRooftopContacts;
  upsertContactProfile: typeof upsertContactProfile;
  // Paid Apollo reveal (tier 4). Only invoked when candidate.allowPaid is true.
  revealRooftopContact: typeof revealRooftopContact;
}

export async function resolveContactableEmail(
  candidate: ContactCandidate,
  deps?: Partial<ContactResolutionDeps>,
): Promise<ResolvedContact> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const verifyDeliverability = deps?.verifyDeliverability ?? verifyEmailDeliverability;
  const isEmailSuppressed = deps?.isEmailSuppressed ?? SuppressionService.isEmailSuppressed;
  const enrich = deps?.enrich ?? enrichDealerEmail;
  const getRooftopContactsFn = deps?.getRooftopContacts ?? getRooftopContacts;
  const upsertContactProfileFn = deps?.upsertContactProfile ?? upsertContactProfile;
  const revealRooftopContactFn = deps?.revealRooftopContact ?? revealRooftopContact;

  let supabase = deps?.supabase;
  const getSupabase = async (): Promise<SupabaseClient> => {
    if (!supabase) {
      const { getServiceSupabase } = await import("@/lib/supabase-service");
      supabase = getServiceSupabase();
    }
    return supabase;
  };

  // The load-bearing gate: send-safe == not hard-suppressed AND MX-deliverable.
  const sendSafe = async (email: string): Promise<boolean> => {
    if (await isEmailSuppressed(await getSupabase(), email)) return false;
    return (await verifyDeliverability(email)).deliverable;
  };

  const now = new Date();

  // Persist a resolved contact onto the rooftop-shared profile (B2c write-through)
  // so the rooftop's twin reuses it next time. Fail-open — a profile write must
  // never break resolution.
  const writeThrough = async (
    email: string,
    status: ContactStatus,
    source: string | null,
    person?: { name?: string | null; title?: string | null; phone?: string | null; contactSource?: string | null; contactConfidence?: string | null },
  ): Promise<void> => {
    if (!candidate.rooftopId) return;
    try {
      await upsertContactProfileFn(candidate.rooftopId, {
        email,
        emailVerificationStatus: status,
        emailSource: source,
        emailVerifiedAt: now,
        name: person?.name ?? null,
        title: person?.title ?? null,
        phone: person?.phone ?? null,
        contactSource: person?.contactSource ?? null,
        contactConfidence: person?.contactConfidence ?? null,
      });
    } catch (err) {
      logger.warn(`[contact-resolution] rooftop profile write-through failed for ${candidate.id}:`, err);
    }
  };

  // 0. Rooftop-shared reuse — a contact already resolved for this rooftop's twin
  // (registered dealer ↔ prospect share one DealerContactProfile). Tried before
  // any cold work, best-provenance first, and re-checked send-safe (suppression
  // always; MX only when stale). Fail-open: profile-read errors just fall through.
  if (candidate.rooftopId) {
    const shared = await getRooftopContactsFn(candidate.rooftopId, { prisma });
    for (const c of shared) {
      if (!c.email) continue;
      if (!(SEND_SAFE_STATUSES as readonly string[]).includes(c.emailVerificationStatus ?? "")) continue;
      if (await isEmailSuppressed(await getSupabase(), c.email)) continue;
      const deliverable = isContactStale(c.emailVerifiedAt, now)
        ? (await verifyDeliverability(c.email)).deliverable
        : true;
      if (deliverable) {
        // Persist the reused address onto THIS prospect so the send path (which
        // reads prospect.email, not the rooftop profile) can actually reach it —
        // otherwise coverage would count a prospect Block C can't send to. If the
        // write throws it propagates to the caller (coverage skips the prospect →
        // not counted): contactable must always be sendable (fail-closed).
        await prisma.dealerProspect.update({
          where: { id: candidate.id },
          data: {
            email: c.email,
            emailSource: c.emailSource ?? "rooftop_reuse",
            emailVerificationStatus: c.emailVerificationStatus,
            emailVerifiedAt: now,
          },
        });
        return {
          contactable: true,
          email: c.email,
          status: c.emailVerificationStatus as ContactStatus,
          source: "rooftop_reuse",
        };
      }
    }
  }

  // 1. Reuse — an existing send-safe address, re-checked. Suppression is ALWAYS
  // re-checked (a since-bounced address must never be reused → falls through to
  // re-resolve). The MX re-check is applied only when the contact is STALE
  // (older than CONTACT_STALE_MONTHS); a fresh contact is trusted on the
  // suppression check alone (cheap-first). Absent emailVerifiedAt → stale.
  if (
    candidate.email &&
    (SEND_SAFE_STATUSES as readonly string[]).includes(candidate.emailVerificationStatus ?? "")
  ) {
    const suppressed = await isEmailSuppressed(await getSupabase(), candidate.email);
    if (!suppressed) {
      const deliverable = isContactStale(candidate.emailVerifiedAt, now)
        ? (await verifyDeliverability(candidate.email)).deliverable
        : true;
      if (deliverable) {
        return {
          contactable: true,
          email: candidate.email,
          status: candidate.emailVerificationStatus as ContactStatus,
          source: "reuse",
        };
      }
    }
  }

  // 2. Role-derivation — walk the ranked role dictionary on the dealership's own
  // domain and take the FIRST send-safe inbox (one address). A hard-bounced role
  // inbox is suppressed, so the walk-down skips it and tries the next-ranked
  // prefix (bounce→re-resolve within the role tier). Deliverable-by-domain but
  // INFERRED (mailbox existence unknown), so persisted as ROLE_DERIVED, never
  // person-VERIFIED.
  const host = normalizeWebsiteHost(candidate.website);
  if (host) {
    for (const prefix of ROLE_PREFIXES) {
      const derived = `${prefix}@${host}`;
      if (await sendSafe(derived)) {
        await prisma.dealerProspect.update({
          where: { id: candidate.id },
          data: {
            email: derived,
            emailSource: "role_derived",
            emailVerificationStatus: "ROLE_DERIVED",
            emailVerifiedAt: now,
            // A role inbox is nobody's personal mailbox — clear any stale person
            // block so outreach never greets a named individual at a shared inbox
            // (e.g. after a VERIFIED person address bounces and we re-resolve here).
            contactName: null,
            contactTitle: null,
            contactPhone: null,
            contactSource: null,
            contactConfidence: null,
            contactSourceUrl: null,
          },
        });
        await writeThrough(derived, "ROLE_DERIVED", "role_derived");
        return { contactable: true, email: derived, status: "ROLE_DERIVED", source: "role_derived" };
      }
    }
  }

  // 3. Gemini (Y1) — best-effort; a found person email that is send-safe → VERIFIED.
  try {
    const r = await enrich({
      dealerProspectId: candidate.id,
      dealerName: candidate.name,
      city: candidate.city ?? "",
      state: candidate.state ?? "",
      website: candidate.website ?? null,
      persist: false,
    });
    // A transient provider failure (errored) or a recency-guard short-circuit
    // (skipped) must NOT stamp anything — errored stays retriable, skipped already
    // has a fresh emailEnrichedAt.
    if (!r.errored && !r.skipped) {
      if (r.email && (await sendSafe(r.email))) {
        const data: Prisma.DealerProspectUpdateInput = {
          email: r.email,
          emailSource: r.source,
          emailVerifiedAt: now,
          emailEnrichedAt: now,
          emailVerificationStatus: "VERIFIED",
        };
        if (r.contactName) {
          data.contactName = r.contactName;
          data.contactTitle = r.contactTitle;
          data.contactPhone = r.contactPhone;
          data.contactSource = r.contactSource;
          data.contactConfidence = r.contactConfidence;
          data.contactSourceUrl = r.contactSourceUrl;
        }
        await prisma.dealerProspect.update({ where: { id: candidate.id }, data });
        await writeThrough(r.email, "VERIFIED", r.source, {
          name: r.contactName, title: r.contactTitle, phone: r.contactPhone,
          contactSource: r.contactSource, contactConfidence: r.contactConfidence,
        });
        return { contactable: true, email: r.email, status: "VERIFIED", source: r.source };
      }
      // Gemini RAN but produced nothing send-safe. Record the attempt (stamp
      // emailEnrichedAt) so the 30-day recency guard suppresses re-hitting the LLM
      // on every subsequent coverage assessment — the M4b re-hit loop. Preserve a
      // found ISM contact block even without a usable email.
      const data: Prisma.DealerProspectUpdateInput = {
        emailEnrichedAt: now,
        emailVerificationStatus: r.email ? "UNVERIFIED" : "NONE",
      };
      if (r.contactName) {
        data.contactName = r.contactName;
        data.contactTitle = r.contactTitle;
        data.contactPhone = r.contactPhone;
        data.contactSource = r.contactSource;
        data.contactConfidence = r.contactConfidence;
        data.contactSourceUrl = r.contactSourceUrl;
      }
      await prisma.dealerProspect.update({ where: { id: candidate.id }, data });
    }
  } catch (err) {
    logger.warn(`[contact-resolution] enrich failed for ${candidate.id}:`, err);
  }

  // 4. Apollo (PAID) — gated. Fires ONLY when the caller opts in via
  // candidate.allowPaid (post-deposit, dealer selected for a live auction), all
  // free tiers above have failed, and we have a rooftop to key the reveal/cache
  // + budget ledger to. The pre-deposit coverage / Y2 path never sets allowPaid,
  // so a paid reveal can never fire there (the pre-deposit leak is closed). The
  // reveal itself is off/capped until enabled + the probe sets the ledger cap.
  if (candidate.allowPaid && candidate.rooftopId) {
    const revealed = await revealRooftopContactFn(
      {
        rooftopId: candidate.rooftopId,
        name: candidate.name,
        website: candidate.website,
        city: candidate.city,
        state: candidate.state,
        consumer: "live",
      },
      { prisma },
    );
    if (revealed?.email && (await sendSafe(revealed.email))) {
      await prisma.dealerProspect.update({
        where: { id: candidate.id },
        data: {
          email: revealed.email,
          emailSource: "apollo",
          emailVerificationStatus: "VERIFIED",
          emailVerifiedAt: now,
          contactName: revealed.contactName,
          contactTitle: revealed.contactTitle,
        },
      });
      await writeThrough(revealed.email, "VERIFIED", "apollo", {
        name: revealed.contactName,
        title: revealed.contactTitle,
      });
      return { contactable: true, email: revealed.email, status: "VERIFIED", source: "apollo" };
    }
  }

  return { contactable: false };
}
