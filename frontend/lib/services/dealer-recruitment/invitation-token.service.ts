// Dealer invitation tokens — single-use, TTL-bounded, hashed at rest wherever
// the database can store a hash.
//
// This mirrors account-claim.service.ts and REUSES its hashing and token
// generation rather than introducing a second token scheme. Every read and
// write of dealer_invitations token state goes through this module so there is
// exactly ONE place that has to know which physical columns exist.
//
// SCHEMA COMPATIBILITY. The Prisma model declares `tokenHash` and `consumedAt`,
// but migration 20260828000000_dealer_invitation_token_hash has not been applied
// to production. Prisma selects every model scalar by default, so an unqualified
// query on this model fails there (P2022), and `token` is still NOT NULL so an
// insert that omits it violates the constraint. Every query below therefore
// names its columns explicitly and is shaped by the runtime capability probe in
// invitation-schema-compat.ts. The code self-heals the moment the migration is
// applied — no redeploy needed — and the legacy branches are deleted with the
// shim once it is applied everywhere.
//
// SECURITY NOTE (migration window). On the legacy schema there is nowhere to put
// a hash, so the raw token is stored in `token`, exactly as it was before. That
// is the pre-existing production condition, not a new regression; the migration
// is the remedy. Storing the raw value is also what the migration's backfill
// expects (digest(token) == token_hash), so no row written during the window
// becomes unresolvable afterwards.

import { Prisma, DealerInvitationStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  hashToken,
  generateRawToken,
  INVITATION_TOKEN_TTL_MS,
} from "@/lib/services/dealer-recruitment/account-claim.service";
import {
  getInvitationSchemaCapabilities,
  type InvitationSchemaCapabilities,
} from "@/lib/services/dealer-recruitment/invitation-schema-compat";

export interface IssuedInvitationToken {
  /** Raw token — embed in the emailed link ONLY; never logged. */
  rawToken: string;
  tokenHash: string;
  expiresAt: Date;
}

/** Mint an invitation token. Which half is persisted is the caller's schema question. */
export function issueInvitationToken(now: Date = new Date()): IssuedInvitationToken {
  const rawToken = generateRawToken();
  return {
    rawToken,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(now.getTime() + INVITATION_TOKEN_TTL_MS),
  };
}

/**
 * The only columns read back from an invitation. Deliberately excludes
 * `tokenHash`/`consumedAt` so the same select is valid against BOTH physical
 * schemas — `status` already answers "has this been consumed?", because every
 * consume path sets ACCEPTED and consumed_at together and the migration
 * backfills consumed_at from accepted_at for pre-existing accepted rows.
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

/** Columns to write when minting a NEW invitation. */
export function buildInvitationTokenFields(
  issued: IssuedInvitationToken,
  caps: InvitationSchemaCapabilities,
): { token?: string; tokenHash?: string } {
  const fields: { token?: string; tokenHash?: string } = {};
  if (caps.hasTokenHash) fields.tokenHash = issued.tokenHash;
  // Write the plaintext column ONLY when the database still demands it: either
  // there is no hash column, or `token` is still NOT NULL (partially applied
  // migration). Once the migration is fully applied this branch goes cold.
  if (caps.hasToken && (!caps.hasTokenHash || caps.tokenRequired)) {
    fields.token = issued.rawToken;
  }
  return fields;
}

/** Columns to write when ROTATING an invitation's token (resend). */
export function buildInvitationRotateFields(
  issued: IssuedInvitationToken,
  caps: InvitationSchemaCapabilities,
): { token?: string | null; tokenHash?: string } {
  const fields: { token?: string | null; tokenHash?: string } = {};
  if (caps.hasTokenHash) fields.tokenHash = issued.tokenHash;
  if (caps.hasToken) {
    // Null the plaintext column when it is no longer needed, so the PREVIOUS
    // emailed link stops resolving. A resend must invalidate what it replaces.
    fields.token = !caps.hasTokenHash || caps.tokenRequired ? issued.rawToken : null;
  }
  return fields;
}

/** OR-branches that can locate an invitation from a raw token. */
export function buildInvitationLookup(
  rawToken: string,
  caps: InvitationSchemaCapabilities,
): Prisma.DealerInvitationWhereInput {
  const or: Prisma.DealerInvitationWhereInput[] = [];
  if (caps.hasTokenHash) or.push({ tokenHash: hashToken(rawToken) });
  // Plaintext lookup covers rows written before the migration (and rows written
  // by this module while running on the legacy schema).
  if (caps.hasToken) or.push({ token: rawToken });
  return { OR: or };
}

/**
 * The atomic consume predicate + mutation.
 *
 * `status: PENDING` is the guard in BOTH modes: it is exactly as atomic as a
 * `consumedAt: null` guard (the winner flips the row under a row lock) and it is
 * additionally correct against a row the expiry sweep has just retired, which a
 * consumedAt-only guard would let through.
 */
export function buildConsumeArgs(
  invitationId: string,
  dealerId: string,
  now: Date,
  caps: InvitationSchemaCapabilities,
) {
  return {
    where: {
      id: invitationId,
      status: DealerInvitationStatus.PENDING,
      ...(caps.hasConsumedAt ? { consumedAt: null } : {}),
    },
    data: {
      status: DealerInvitationStatus.ACCEPTED,
      acceptedAt: now,
      dealerId,
      ...(caps.hasConsumedAt ? { consumedAt: now } : {}),
    },
  };
}

// ── Database operations ─────────────────────────────────────────────────────

/** Anything that can write dealer_invitations — the client or a transaction client. */
export type InvitationWriteClient = Pick<PrismaClient, "dealerInvitation">;

export interface CreatedInvitation {
  id: string;
  /** Raw token for the emailed link. Never persisted when a hash column exists. */
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
  const caps = await getInvitationSchemaCapabilities();
  const issued = issueInvitationToken(params.now);
  const tokenFields = buildInvitationTokenFields(issued, caps);

  if (tokenFields.token === undefined && tokenFields.tokenHash === undefined) {
    // Neither column exists: there is nowhere to store the token, so the link
    // could never be redeemed. Fail loudly rather than persist a dead invite.
    throw new Error(
      "dealer_invitations has neither `token` nor `token_hash` — cannot issue an invitation",
    );
  }

  const row = await prisma.dealerInvitation.create({
    data: {
      dealershipName: params.dealershipName,
      contactName: params.contactName,
      email: params.email.toLowerCase(),
      personalMessage: params.personalMessage ?? null,
      expiresAt: issued.expiresAt,
      invitedBy: params.invitedBy,
      status: DealerInvitationStatus.PENDING,
      ...tokenFields,
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
  const caps = await getInvitationSchemaCapabilities();
  if (!caps.hasToken && !caps.hasTokenHash) {
    // No column to match on. Do not fall through to an empty OR — say plainly
    // that nothing can be found rather than depend on Prisma's empty-filter
    // semantics for a security decision.
    return { ok: false, reason: "not_found" };
  }
  const invitation = await prisma.dealerInvitation.findFirst({
    where: buildInvitationLookup(rawToken, caps),
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
  // The probe is cached and warmed by validateInvitationToken before any caller
  // opens a transaction, so this does not borrow a second pooled connection
  // while one is held. It also fails safe rather than throwing, so it can never
  // abort a caller's transaction.
  const caps = await getInvitationSchemaCapabilities();
  const res = await client.dealerInvitation.updateMany(
    buildConsumeArgs(invitationId, dealerId, now, caps),
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
  const caps = await getInvitationSchemaCapabilities();
  const issued = issueInvitationToken(now);

  const res = await prisma.dealerInvitation.updateMany({
    where: {
      id: invitationId,
      status: { in: [DealerInvitationStatus.PENDING, DealerInvitationStatus.EXPIRED] },
    },
    data: {
      expiresAt: issued.expiresAt,
      status: DealerInvitationStatus.PENDING,
      ...buildInvitationRotateFields(issued, caps),
    },
  });

  if (res.count !== 1) return null;
  return { rawToken: issued.rawToken, expiresAt: issued.expiresAt };
}

/**
 * Expire invitations whose TTL has elapsed.
 *
 * Expiry used to be applied only lazily, when someone happened to hit the token
 * — which is why production holds a PENDING row that is already past its
 * expiresAt. This runs from the EXISTING dealer-invitation-reminder cron rather
 * than a new job, so an expired invitation is never reported as still pending.
 * It touches only columns that exist in every schema version.
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
