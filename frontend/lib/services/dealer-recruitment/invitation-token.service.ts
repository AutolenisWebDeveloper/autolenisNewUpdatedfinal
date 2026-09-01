// Dealer invitation tokens — single-use, TTL-bounded, hashed at rest.
//
// This mirrors account-claim.service.ts and REUSES its hashing and token
// generation rather than introducing a second token scheme. Every read and
// write of dealer_invitations token state goes through this module, so the
// write guards live in one place and are covered by one test suite
// (__tests__/invitation-guards.test.ts).
//
// Migration 20260828000000_dealer_invitation_token_hash is applied everywhere:
// token_hash and consumed_at exist and `token` is nullable. The runtime
// capability probe that carried this module across the two schema generations is
// gone, and every query below is written for the migrated schema directly.

import { Prisma, DealerInvitationStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  hashToken,
  generateRawToken,
  INVITATION_TOKEN_TTL_MS,
} from "@/lib/services/dealer-recruitment/account-claim.service";
export interface IssuedInvitationToken {
  /** Raw token — embed in the emailed link ONLY; never logged. */
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Mint an invitation token. Only the hash is ever persisted. */
export function issueInvitationToken(now: Date = new Date()): IssuedInvitationToken {
  const rawToken = generateRawToken();
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + INVITATION_TOKEN_TTL_MS),
  };
}

/**
 * The only columns read back from an invitation. `status` already answers "has
 * this been consumed?", because every consume path sets ACCEPTED and consumed_at
 * together and the migration backfilled consumed_at from accepted_at for
 * pre-existing accepted rows — so there is no reason to read token material
 * into a validation that does not need it.
 */
const INVITATION_CORE_SELECT = {
  id: true,
  email: true,
  dealershipName: true,
  contactName: true,
  status: true,
  expiresAt: true,
} satisfies Prisma.DealerInvitationSelect;

// ── Pure query shaping (no database; unit-tested directly) ───────────────────

/** Columns to write when minting a NEW invitation: the hash, and nothing else. */
export function buildInvitationTokenFields(
  issued: IssuedInvitationToken,
): { tokenHash: string } {
  return { tokenHash: issued.tokenHash };
}

/** Columns to write when ROTATING an invitation's token (resend). */
export function buildInvitationRotateFields(
  issued: IssuedInvitationToken,
): { token: null; tokenHash: string } {
  // The new hash replaces the old, and any residual plaintext left by a
  // pre-migration row is nulled: a resend must invalidate what it replaces.
  return { tokenHash: issued.tokenHash, token: null };
}

/** OR-branches that can locate an invitation from a raw token. */
export function buildInvitationLookup(
  rawToken: string,
): Prisma.DealerInvitationWhereInput {
  return {
    OR: [
      { tokenHash: hashToken(rawToken) },
      // Rows backfilled by the migration still carry their original plaintext
      // `token`, so this branch stays until that column is dropped.
      { token: rawToken },
    ],
  };
}

/**
 * The atomic consume predicate + mutation.
 *
 * `status: PENDING` is part of the guard, not decoration: it is exactly as
 * atomic as `consumedAt: null` (the winner flips the row under a row lock) and
 * it is additionally correct against a row the expiry sweep retired between
 * validation and consumption, which a consumedAt-only guard would let through.
 */
export function buildConsumeArgs(invitationId: string, dealerId: string, now: Date) {
  return {
    where: {
      id: invitationId,
      status: DealerInvitationStatus.PENDING,
      consumedAt: null,
    },
    data: {
      status: DealerInvitationStatus.ACCEPTED,
      acceptedAt: now,
      dealerId,
      consumedAt: now,
    },
  };
}

// ── Database operations ─────────────────────────────────────────────────────

/** Anything that can write dealer_invitations — the client or a transaction client. */
export type InvitationWriteClient = Pick<PrismaClient, "dealerInvitation">;

export interface CreatedInvitation {
  id: string;
  /** Raw token for the emailed link. Never persisted. */
  rawToken: string;
  expiresAt: Date;
}

/** Mint and persist a new invitation. The ONLY way an invitation is created. */
export async function createInvitation(params: {
  dealershipName: string;
  contactName: string;
  email: string;
  personalMessage?: string | null;
  invitedBy: string;
  now?: Date;
}): Promise<CreatedInvitation> {
  const issued = issueInvitationToken(params.now);

  const row = await prisma.dealerInvitation.create({
    data: {
      dealershipName: params.dealershipName,
      contactName: params.contactName,
      email: params.email.toLowerCase(),
      personalMessage: params.personalMessage ?? null,
      expiresAt: issued.expiresAt,
      invitedBy: params.invitedBy,
      status: DealerInvitationStatus.PENDING,
      ...buildInvitationTokenFields(issued),
    },
    select: { id: true },
  });

  return { id: row.id, rawToken: issued.rawToken, expiresAt: issued.expiresAt };
}

export type InvitationValidation =
  | { ok: true; invitationId: string; email: string; dealershipName: string; contactName: string }
  | { ok: false; reason: "not_found" | "consumed" | "expired" | "cancelled" };

/** Validate a raw invitation token without consuming it. */
export async function validateInvitationToken(
  rawToken: string,
  now: Date = new Date(),
): Promise<InvitationValidation> {
  const invitation = await prisma.dealerInvitation.findFirst({
    where: buildInvitationLookup(rawToken),
    select: INVITATION_CORE_SELECT,
  });

  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.status === DealerInvitationStatus.CANCELLED) {
    return { ok: false, reason: "cancelled" };
  }
  if (invitation.status === DealerInvitationStatus.ACCEPTED) {
    return { ok: false, reason: "consumed" };
  }
  // A row the sweep has already retired is expired regardless of the timestamp.
  if (invitation.status === DealerInvitationStatus.EXPIRED || invitation.expiresAt < now) {
    return { ok: false, reason: "expired" };
  }

  return {
    ok: true,
    invitationId: invitation.id,
    email: invitation.email,
    dealershipName: invitation.dealershipName,
    contactName: invitation.contactName,
  };
}

/**
 * Atomically consume an invitation. Returns true only if THIS call won, so two
 * concurrent claims of the same link can never both create a dealer.
 *
 * Accepts a transaction client so the claim route can consume inside the same
 * transaction that creates the User and Dealer.
 */
export async function consumeInvitationToken(
  invitationId: string,
  dealerId: string,
  now: Date = new Date(),
  client: InvitationWriteClient = prisma,
): Promise<boolean> {
  const res = await client.dealerInvitation.updateMany(
    buildConsumeArgs(invitationId, dealerId, now),
  );
  return res.count === 1;
}

/**
 * Rotate an invitation's token and extend its TTL (admin resend).
 *
 * Guarded on status so a resend can never resurrect an ACCEPTED or CANCELLED
 * invitation, even if the caller's earlier read raced with a claim. Returns the
 * new raw token, or null when nothing was updated.
 */
export async function refreshInvitationToken(
  invitationId: string,
  now: Date = new Date(),
): Promise<{ rawToken: string; expiresAt: Date } | null> {
  const issued = issueInvitationToken(now);

  const res = await prisma.dealerInvitation.updateMany({
    where: {
      id: invitationId,
      status: { in: [DealerInvitationStatus.PENDING, DealerInvitationStatus.EXPIRED] },
    },
    data: {
      expiresAt: issued.expiresAt,
      status: DealerInvitationStatus.PENDING,
      ...buildInvitationRotateFields(issued),
    },
  });

  if (res.count !== 1) return null;
  return { rawToken: issued.rawToken, expiresAt: issued.expiresAt };
}

/**
 * Cancel an invitation (admin action).
 *
 * Guarded on status for the same reason as the resend above: the route reads the
 * invitation, decides it is cancellable, and only then writes. Without the guard
 * a claim landing in that window would be silently undone — an ACCEPTED
 * invitation, with a real dealer attached, flipped back to CANCELLED. Extracted
 * here rather than left inline in the route so the guard is covered by the unit
 * suite; the predicate and the semantics are unchanged.
 *
 * @returns true only if a cancellable row was actually cancelled by this call.
 */
export async function cancelInvitation(invitationId: string): Promise<boolean> {
  const res = await prisma.dealerInvitation.updateMany({
    where: {
      id: invitationId,
      status: { in: [DealerInvitationStatus.PENDING, DealerInvitationStatus.EXPIRED] },
    },
    data: { status: DealerInvitationStatus.CANCELLED },
  });
  return res.count === 1;
}

/**
 * Expire invitations whose TTL has elapsed.
 *
 * Expiry used to be applied only lazily, when someone happened to hit the token
 * — which is why production holds a PENDING row that is already past its
 * expiresAt. This runs from the EXISTING dealer-invitation-reminder cron rather
 * than a new job, so an expired invitation is never reported as still pending.
 *
 * @returns the number of rows expired.
 */
export async function expireStaleInvitations(now: Date = new Date()): Promise<number> {
  const res = await prisma.dealerInvitation.updateMany({
    where: { status: DealerInvitationStatus.PENDING, expiresAt: { lt: now } },
    data: { status: DealerInvitationStatus.EXPIRED },
  });
  return res.count;
}
