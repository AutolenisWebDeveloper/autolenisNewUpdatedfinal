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
import { enrichDealerEmail } from "./email-enrichment.service";

// The emailVerificationStatus values that mean "has a send-safe address" —
// contactable for coverage + eligible for Block C mint. The invariant is
// literally "contactable == send-safe", so the constant is named for it.
export const SEND_SAFE_STATUSES = ["VERIFIED", "ROLE_DERIVED"] as const;
// Derived-inbox guesses in walk-down order (Block B tries alternates on bounce).
// MX is domain-level, so any prefix on a live domain verifies; [0] is stored.
export const ROLE_PREFIXES = ["internetsales", "sales"] as const;

export interface ContactCandidate {
  id: string;
  name: string;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  email?: string | null;
  emailVerificationStatus?: string | null;
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
}

export async function resolveContactableEmail(
  candidate: ContactCandidate,
  deps?: Partial<ContactResolutionDeps>,
): Promise<ResolvedContact> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const verifyDeliverability = deps?.verifyDeliverability ?? verifyEmailDeliverability;
  const isEmailSuppressed = deps?.isEmailSuppressed ?? SuppressionService.isEmailSuppressed;
  const enrich = deps?.enrich ?? enrichDealerEmail;

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

  // 1. Reuse — but only if the existing address is STILL send-safe (a since-bounced
  // VERIFIED address must not be counted; fall through to re-resolve).
  if (
    candidate.email &&
    (SEND_SAFE_STATUSES as readonly string[]).includes(candidate.emailVerificationStatus ?? "") &&
    (await sendSafe(candidate.email))
  ) {
    return {
      contactable: true,
      email: candidate.email,
      status: candidate.emailVerificationStatus as ContactStatus,
      source: "reuse",
    };
  }

  // 2. Role-derivation — a generic role inbox on the dealership's own domain.
  // Deliverable-by-domain but INFERRED (mailbox existence unknown), so persisted
  // as ROLE_DERIVED, never person-VERIFIED. Block B walk-down handles a bounce.
  const host = normalizeWebsiteHost(candidate.website);
  if (host) {
    const derived = `${ROLE_PREFIXES[0]}@${host}`;
    if (await sendSafe(derived)) {
      await prisma.dealerProspect.update({
        where: { id: candidate.id },
        data: {
          email: derived,
          emailSource: "role_derived",
          emailVerificationStatus: "ROLE_DERIVED",
          emailVerifiedAt: new Date(),
        },
      });
      return { contactable: true, email: derived, status: "ROLE_DERIVED", source: "role_derived" };
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
      const now = new Date();
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

  return { contactable: false };
}
