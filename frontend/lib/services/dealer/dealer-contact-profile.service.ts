// Block B / B1 — DealerContactProfile service.
//
// Person-level dealer contact identity keyed to the canonical A2 DealerRooftop, so
// a registered Dealer and its prospect twin share ONE contact history. This is the
// single home the Block B contact waterfall writes resolved contacts into, and the
// substrate for staleness re-checks (lastVerifiedAt) and shared-inbox collapse
// (emailKey). Reuses the A2 identity normalizers — no parallel matching logic.
//
// Merge rules (upsert): dedup within a rooftop by normalized email (else name);
// NEVER write a stronger email-verification status down to a weaker one; fill null
// identity fields but never clobber an existing non-null name/title/phone.

import type { PrismaClient } from "@prisma/client";
import { logger } from "@/lib/logger";
import { prisma as defaultPrisma } from "@/lib/prisma";
import { normalizeEmail } from "@/lib/utils/phone";
import { normalizeDealerName, phoneKey } from "@/lib/services/dealer/dealer-identity.service";

// Injectable so the dealer suite tests with a fake prisma (test:dealer runs
// without --experimental-test-module-mocks — dependency injection, no module mocks).
export interface ContactProfileDeps {
  prisma: PrismaClient;
}

export interface ContactProfileInput {
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  emailSource?: string | null;
  emailVerificationStatus?: string | null;
  emailVerifiedAt?: Date | null;
  contactSource?: string | null;
  contactConfidence?: string | null;
}

// Ranking for the never-downgrade rule. {VERIFIED, ROLE_DERIVED} are the send-safe
// statuses (mirrors SEND_SAFE_STATUSES); anything unknown ranks 0.
const STATUS_RANK: Record<string, number> = { VERIFIED: 3, ROLE_DERIVED: 2, UNVERIFIED: 1 };
const statusRank = (s?: string | null): number => STATUS_RANK[s ?? ""] ?? 0;
const isSendSafe = (s?: string | null): boolean => s === "VERIFIED" || s === "ROLE_DERIVED";

/**
 * Create or update the contact profile for `rooftopId` from `input`, deduping
 * within the rooftop by a fallback chain (normalized email → name → phone) so a
 * two-phase discovery upgrades one record instead of creating duplicates.
 * Returns the profile, or null when no identity key (email/name/phone) is
 * derivable (nothing to dedup or usefully store).
 */
export async function upsertContactProfile(
  rooftopId: string,
  input: ContactProfileInput,
  deps?: Partial<ContactProfileDeps>,
): Promise<{ id: string } | null> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const emailKey = normalizeEmail(input.email);
  const nameKey = normalizeDealerName(input.name);
  const pKey = input.phone ? phoneKey(input.phone) : null;

  // No derivable identity key → nothing to dedup or usefully store. Skip rather
  // than create an unbounded stream of anonymous rows on repeated reconcile.
  if (!emailKey && !nameKey && !pKey) {
    logger.info("[dealer-contact-profile] no identity key (email/name/phone) — skipping upsert", {
      rooftopId,
    });
    return null;
  }

  // Dedup within the rooftop by a FALLBACK CHAIN, not a single incoming key:
  // email → name → phone. This upgrades an existing record instead of creating a
  // duplicate when discovery is two-phase (a name-only contact later gains a
  // verified email — the email lookup misses, but the name lookup finds it and
  // the email block below fills the newly-arrived address onto it).
  let existing: Record<string, unknown> | null = null;
  if (emailKey) {
    existing = (await prisma.dealerContactProfile.findFirst({ where: { rooftopId, emailKey } })) as Record<string, unknown> | null;
  }
  if (!existing && nameKey) {
    existing = (await prisma.dealerContactProfile.findFirst({ where: { rooftopId, nameKey } })) as Record<string, unknown> | null;
  }
  if (!existing && pKey) {
    existing = (await prisma.dealerContactProfile.findFirst({ where: { rooftopId, phoneKey: pKey } })) as Record<string, unknown> | null;
  }

  if (!existing) {
    const created = await prisma.dealerContactProfile.create({
      data: {
        rooftopId,
        name: input.name ?? null,
        nameKey,
        title: input.title ?? null,
        email: input.email ?? null,
        emailKey,
        phone: input.phone ?? null,
        phoneKey: pKey,
        emailSource: input.emailSource ?? null,
        emailVerificationStatus: input.emailVerificationStatus ?? null,
        emailVerifiedAt: input.emailVerifiedAt ?? null,
        contactSource: input.contactSource ?? null,
        contactConfidence: input.contactConfidence ?? null,
        lastVerifiedAt: isSendSafe(input.emailVerificationStatus) ? new Date() : null,
      },
    });
    return { id: created.id };
  }

  const prev = existing;
  const data: Record<string, unknown> = {};

  // Identity fields: fill only when the existing value is null (never clobber).
  if (prev.name == null && input.name != null) {
    data.name = input.name;
    data.nameKey = nameKey;
  }
  if (prev.title == null && input.title != null) data.title = input.title;
  if (prev.phone == null && input.phone != null) {
    data.phone = input.phone;
    data.phoneKey = pKey;
  }

  // Email block. Take the incoming address only when it genuinely improves what
  // we hold: fill an empty slot, upgrade a weaker status, or refresh the SAME
  // address's provenance. Never write a VERIFIED status down, and never replace
  // one equal-rank address with a different equal-rank address (that would
  // discard a working contact for no gain).
  const incomingRank = statusRank(input.emailVerificationStatus);
  const existingRank = statusRank(prev.emailVerificationStatus as string | null);
  const prevEmailKey = (prev.emailKey as string | null) ?? null;
  const takeEmail =
    input.email != null &&
    emailKey != null &&
    (prevEmailKey == null || incomingRank > existingRank || (incomingRank >= existingRank && emailKey === prevEmailKey));
  if (takeEmail) {
    data.email = input.email;
    data.emailKey = emailKey;
    data.emailSource = input.emailSource ?? (prev.emailSource as string | null) ?? null;
    data.emailVerificationStatus = input.emailVerificationStatus ?? (prev.emailVerificationStatus as string | null) ?? null;
    data.emailVerifiedAt = input.emailVerifiedAt ?? (prev.emailVerifiedAt as Date | null) ?? null;
    if (isSendSafe(input.emailVerificationStatus)) data.lastVerifiedAt = new Date();
  }

  // Contact provenance: fill when absent.
  if (prev.contactSource == null && input.contactSource != null) data.contactSource = input.contactSource;
  if (prev.contactConfidence == null && input.contactConfidence != null) data.contactConfidence = input.contactConfidence;

  // Nothing materially changed → skip the write so updatedAt keeps meaning
  // "last real change" (staleness/observability reads stay clean).
  if (Object.keys(data).length === 0) return { id: prev.id as string };

  const updated = await prisma.dealerContactProfile.update({
    where: { id: prev.id as string },
    data,
  });
  return { id: updated.id };
}

/**
 * Backfill/refresh a rooftop-keyed contact profile from a DealerProspect's
 * denormalized contact.* fields. Skips (returns null) when the prospect has no
 * rooftop — a contact profile must never be orphaned from a rooftop.
 */
export async function reconcileProspectContact(
  prospectId: string,
  deps?: Partial<ContactProfileDeps>,
): Promise<{ id: string } | null> {
  const prisma = deps?.prisma ?? defaultPrisma;
  const p = await prisma.dealerProspect.findUnique({
    where: { id: prospectId },
    select: {
      rooftopId: true,
      contactName: true,
      contactTitle: true,
      contactPhone: true,
      email: true,
      emailVerificationStatus: true,
      emailSource: true,
      contactSource: true,
      contactConfidence: true,
    },
  });

  if (!p || !p.rooftopId) {
    logger.info("[dealer-contact-profile] prospect has no rooftop — skipping reconcile", {
      prospectId,
    });
    return null;
  }

  return upsertContactProfile(
    p.rooftopId,
    {
      name: p.contactName,
      title: p.contactTitle,
      phone: p.contactPhone,
      email: p.email,
      emailVerificationStatus: p.emailVerificationStatus,
      emailSource: p.emailSource,
      contactSource: p.contactSource,
      contactConfidence: p.contactConfidence,
    },
    deps,
  );
}
