// Dealer invitation tokens — hashed at rest, single-use, 7-day TTL.
//
// This deliberately mirrors account-claim.service.ts and REUSES its hashing and
// token generation rather than introducing a second token scheme. Invitations
// previously stored and looked up a plaintext token with a 72h TTL and no
// consumed_at, so a database leak was replayable and single use was not
// structurally enforced.

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

  const invitation =
    (await prisma.dealerInvitation.findUnique({ where: { tokenHash } })) ??
    (await prisma.dealerInvitation.findUnique({ where: { token: rawToken } }));

  if (!invitation) return { ok: false, reason: "not_found" };
  if (invitation.status === "CANCELLED") return { ok: false, reason: "cancelled" };
  if (invitation.consumedAt || invitation.status === "ACCEPTED") {
    return { ok: false, reason: "consumed" };
  }
  if (invitation.expiresAt < now) return { ok: false, reason: "expired" };

  return {
    ok: true,
    invitationId: invitation.id,
    email: invitation.email,
    dealershipName: invitation.dealershipName,
    contactName: invitation.contactName,
  };
}

/**
 * Atomically consume an invitation. Conditional on `consumedAt: null` so two
 * concurrent claims can never both succeed — identical contract to
 * consumeClaimToken(). Returns true only if THIS call won.
 */
export async function consumeInvitationToken(
  invitationId: string,
  dealerId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const res = await prisma.dealerInvitation.updateMany({
    where: { id: invitationId, consumedAt: null },
    data: { consumedAt: now, acceptedAt: now, status: "ACCEPTED", dealerId },
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
