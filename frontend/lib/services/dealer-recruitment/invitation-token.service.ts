// Dealer invitation tokens — hashed at rest, single-use, 7-day TTL.
//
// This deliberately mirrors account-claim.service.ts and REUSES its hashing and
// token generation rather than introducing a second token scheme. Invitations
// previously stored and looked up a plaintext token with a 72h TTL and no
// consumed_at, so a database leak was replayable and single use was not
// structurally enforced.

import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  hashToken,
  generateRawToken,
  INVITATION_TOKEN_TTL_MS,
} from "@/lib/services/dealer-recruitment/account-claim.service";

export interface IssuedInvitationToken {
  /** Raw token — embed in the emailed link ONLY; never stored or logged. */
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Mint an invitation token. Persists only the hash; returns the raw for the email. */
export function issueInvitationToken(now: Date = new Date()): IssuedInvitationToken {
  const rawToken = generateRawToken();
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + INVITATION_TOKEN_TTL_MS),
  };
}

export type InvitationValidation =
  | { ok: true; invitationId: string; email: string; dealershipName: string; contactName: string }
  | { ok: false; reason: "not_found" | "consumed" | "expired" | "cancelled" };

/**
 * Validate a raw invitation token without consuming it.
 *
 * Looks up by hash. During the migration window a legacy row may still carry a
 * plaintext `token` and no `tokenHash`; that fallback is attempted second so
 * links already in dealers' inboxes keep working until the backfill lands.
 */
export async function validateInvitationToken(
  rawToken: string,
  now: Date = new Date(),
): Promise<InvitationValidation> {
  const tokenHash = hashToken(rawToken);

  // MIGRATION WINDOW ONLY. The plaintext fallback keeps links already sitting in
  // dealers' inboxes working until the backfill in
  // prisma/migrations/20260828000000_dealer_invitation_token_hash has run.
  // REMOVE THIS FALLBACK in the same change that drops the `token` column —
  // leaving it after the drop would be a Prisma runtime error on an unknown field.
  const invitation =
    (await prisma.dealerInvitation.findUnique({ where: { tokenHash } })) ??
    (await prisma.dealerInvitation.findUnique({ where: { token: rawToken } }));

  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.status === "CANCELLED") return { ok: false, reason: "cancelled" };
  if (invitation.consumedAt || invitation.status === "ACCEPTED") {
    return { ok: false, reason: "consumed" };
  }
  // A row the expiry sweep has already retired is expired regardless of the
  // timestamp. Without this, validate would pass a row that consume then
  // refuses (it requires PENDING), and the caller would report the wrong reason.
  if (invitation.status === "EXPIRED" || invitation.expiresAt < now) {
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

/** Anything that can write dealer_invitations — the client or a transaction client. */
export type InvitationWriteClient = Pick<PrismaClient, "dealerInvitation">;

/**
 * Atomically consume an invitation. Returns true only if THIS call won, so two
 * concurrent claims of the same link can never both create a dealer.
 *
 * Guarded on `status: PENDING` as well as `consumedAt: null`. The status guard
 * is exactly as atomic (the winner flips the row under a row lock) and it is
 * additionally correct against a row the expiry sweep retired between
 * validation and consumption, which a consumedAt-only guard would let through.
 *
 * Accepts a transaction client so the claim route can consume inside the same
 * transaction that creates the User and Dealer — the guard is worthless if the
 * caller writes its own unguarded update instead.
 */
export async function consumeInvitationToken(
  invitationId: string,
  dealerId: string,
  now: Date = new Date(),
  client: InvitationWriteClient = prisma,
): Promise<boolean> {
  const res = await client.dealerInvitation.updateMany({
    where: { id: invitationId, status: "PENDING", consumedAt: null },
    data: { consumedAt: now, acceptedAt: now, status: "ACCEPTED", dealerId },
  });
  return res.count === 1;
}

/**
 * Rotate an invitation's token and extend its TTL — the admin resend path.
 *
 * Invitations previously had a SECOND token scheme here: an HMAC of
 * `email:dealershipName:now` with a 72h TTL, written in plaintext. That is
 * replaced by the one scheme this module owns (256-bit random, hashed at rest,
 * 7-day TTL), so there is one way an invitation token comes into existence.
 *
 * Rotation INVALIDATES the superseded link: the stored hash is replaced, and any
 * residual plaintext `token` is nulled, so neither the old hashed link nor a
 * pre-migration plaintext one still resolves.
 *
 * Guarded on status so a resend can never resurrect an ACCEPTED or CANCELLED
 * invitation, even when the caller's earlier read raced with a claim. Returns
 * the new raw token, or null when nothing was updated.
 */
export async function refreshInvitationToken(
  invitationId: string,
  now: Date = new Date(),
): Promise<{ rawToken: string; expiresAt: Date } | null> {
  const { rawToken, tokenHash, expiresAt } = issueInvitationToken(now);

  const res = await prisma.dealerInvitation.updateMany({
    where: { id: invitationId, status: { in: ["PENDING", "EXPIRED"] } },
    data: { tokenHash, token: null, expiresAt, status: "PENDING" },
  });

  if (res.count !== 1) return null;
  return { rawToken, expiresAt };
}

/**
 * Cancel an invitation (admin action).
 *
 * Guarded on status for the same reason as the resend above: the route reads the
 * invitation, decides it is cancellable, and only then writes. Without the guard
 * a claim landing in that window would be silently undone — an ACCEPTED
 * invitation, with a real dealer attached, flipped back to CANCELLED.
 *
 * @returns true only if a cancellable row was actually cancelled by this call.
 */
export async function cancelInvitation(invitationId: string): Promise<boolean> {
  const res = await prisma.dealerInvitation.updateMany({
    where: { id: invitationId, status: { in: ["PENDING", "EXPIRED"] } },
    data: { status: "CANCELLED" },
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
    where: { status: "PENDING", expiresAt: { lt: now } },
    data: { status: "EXPIRED" },
  });
  return res.count;
}
