// The pickup RELEASE TOKEN — hash at rest, single-use, minted only against a real appointment.
//
// WHAT IT REPLACES, and why none of it was salvageable:
//
//  1. TWO generators seeded their nonce from `Math.random()` — `qr.service.ts:5` and
//     `pickup.service.ts:16`. `Math.random` is not a CSPRNG; its output is predictable from
//     observed values. A release credential for a vehicle is exactly the wrong place for it.
//  2. The token was stored in PLAINTEXT in `pickups.qr_code_data` and the dealer scan resolved
//     it by equality (`where: { qrCodeData: qrToken }`), so a database read yielded a working
//     credential.
//  3. `pickups.qr_code_image` stored `QRCode.toDataURL(rawPayload)` — the PNG decodes back to
//     the same raw token. Hashing the token while keeping that column would have passed every
//     test this change names and left the credential readable anyway. Owner ruling,
//     2026-09-16: cleared in the same change, or the hashing is theatre.
//  4. There was no `consumed_at`, so single use was not structurally enforced — a scanned code
//     stayed valid, and a photographed one stayed valid with it.
//  5. `regenerateQr` minted a live 48-hour token for a pickup in ANY state, including one never
//     confirmed, so a scannable credential could exist with no appointment behind it.
//
// THE SHAPE IS PHASE 8'S, DELIBERATELY. `lib/services/esign/invited-signer.service.ts` already
// solved this problem for the co-buyer signing link: mint raw + store hash, resolve read-only,
// consume by compare-and-swap, and return a NAMED REASON rather than an error. Reusing that
// shape — and `hashToken`/`generateRawToken` themselves, so there is one hashing implementation
// rather than one per token table — is golden rule 1 applied. What differs is the subject and
// the ceiling: an envelope's expiry bounds a signing token; the APPOINTMENT bounds this one.
//
// THE COLUMNS ALREADY EXISTED. `token_hash`, `token_expires_at`, `token_consumed_at` and
// `token_revoked_at` arrived with the Phase 1 wave and had never had a writer. This service is
// their first one; migration 20261201000000 adds the two indexes they need.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { hashToken, generateRawToken } from "@/lib/services/dealer-recruitment/account-claim.service";
import { TOKEN_MINTABLE_STATUSES } from "./pickup-statuses";

/**
 * Pickup statuses a release token may be minted for — defect (2) of §8.2's Phase 9 list, as a
 * constant. Declared in `pickup-statuses.ts` (zero dependencies) and re-exported here, because
 * the admin screens need the same list and must not pull `@/lib/prisma` into a client bundle to
 * get it. One list, read by both sides, rather than two kept in step by memory.
 */
export { TOKEN_MINTABLE_STATUSES } from "./pickup-statuses";

/**
 * Deal statuses a release token may exist for.
 *
 * THE PICKUP'S STATUS IS NOT ENOUGH, and the gap is reachable. `cancelDeal` never touches the
 * Pickup row, so a deal cancelled at PICKUP_SCHEDULED leaves `pickups.status` reading SCHEDULED
 * forever. Without this the buyer of a cancelled deal could mint an unlimited stream of live,
 * scannable codes — the platform would refuse them at the scan (`canTransition(CANCELLED,
 * COMPLETED)` is false), but a dealership doing a gate-side visual check would see a valid code
 * on a dead deal. The whole point of this service is that no code exists without an appointment
 * behind it; a cancelled deal has no appointment.
 *
 * THE DERIVATION CHANGED IN PHASE 9, AND THE OLD ONE WAS RIGHT ONLY BY COINCIDENCE. This set
 * was "the statuses from which a deal can still reach COMPLETED", which matched the statuses
 * with a live appointment only because the ladder was flat: `PICKUP_SCHEDULED → COMPLETED` was a
 * single edge. §8.2 defect (8) closed it and inserted `HANDOVER_PENDING`, and the two
 * definitions came apart — "can reach COMPLETED" now yields HANDOVER_PENDING, which is the state
 * AFTER the code has been scanned and consumed.
 *
 * So it is derived from what the code is FOR. A release code opens a handover; it is mintable
 * exactly while the deal can still REACH handover. That is `canTransition(from,
 * HANDOVER_PENDING)` — PICKUP_SCHEDULED, and nothing else. `release-token.test.ts` pins it
 * against the real transition table so the two cannot drift.
 */
export const TOKEN_MINTABLE_DEAL_STATUSES = ["PICKUP_SCHEDULED"] as const;

/**
 * How long a token outlives the appointment it belongs to.
 *
 * The expiry is bound to `scheduledAt`, not to the minting moment: a credential for Tuesday's
 * handover has no business being live on Friday because it happened to be re-issued late. The
 * grace exists because handovers run late — paperwork, a delayed valet, a queue — and a buyer
 * standing at the dealership with an expired code is a support call, not security.
 */
export const TOKEN_GRACE_AFTER_APPOINTMENT_MS = 12 * 60 * 60 * 1000;

/**
 * The floor, for a token minted at or after its own appointment — a same-day re-issue at the
 * kerb, which is the common case for a phone that lost the email.
 */
export const TOKEN_MIN_TTL_MS = 2 * 60 * 60 * 1000;

/** `generateRawToken()` is `crypto.randomBytes(32).toString("hex")` — 64 lowercase hex chars. */
const RAW_TOKEN_SHAPE = /^[0-9a-f]{64}$/;

export interface IssuedReleaseToken {
  /** Raw token — put it in the link or the rendered QR ONLY. Never stored, never logged. */
  rawToken: string;
  expiresAt: Date;
}

export type ReleaseTokenReason =
  | "not_found"
  | "consumed"
  | "revoked"
  | "expired"
  | "pickup_not_releasable";

export type ReleaseTokenResolution =
  | { ok: true; view: ReleaseTokenView }
  | { ok: false; reason: ReleaseTokenReason };

/**
 * Everything a resolved release token exposes — a type rather than a promise.
 *
 * Adding a field here widens what a bearer credential discloses, so this is the place to argue
 * for one. It carries no buyer name, no contact details, no price and no dealership identity:
 * the scanner already knows which dealership it is, and everything else is looked up under the
 * scanner's OWN authorisation, not the token's.
 */
export interface ReleaseTokenView {
  pickupId: string;
  dealId: string;
  status: string;
  scheduledAt: Date | null;
  /** When this credential stops working — the appointment's window, not the minting moment. */
  expiresAt: Date | null;
}

/** The expiry a token minted now, for this appointment, should carry. */
export function releaseTokenExpiry(scheduledAt: Date | null, now: Date): Date {
  const floor = new Date(now.getTime() + TOKEN_MIN_TTL_MS);
  if (!scheduledAt) return floor;
  const bound = new Date(scheduledAt.getTime() + TOKEN_GRACE_AFTER_APPOINTMENT_MS);
  // A late re-issue never shortens the window below the floor; an early one never extends it
  // past the appointment's own grace.
  return bound.getTime() > floor.getTime() ? bound : floor;
}

/**
 * Mint a release token for a pickup, returning the raw token ONCE.
 *
 * RE-MINTING REVOKES. Writing a new hash replaces the old one, so the previous credential stops
 * resolving the moment this returns — which is revoke-and-reissue, and the reason a reschedule
 * cannot leave two live codes for one vehicle. `token_consumed_at` and `token_revoked_at` are
 * cleared with it: the new token is new, and inheriting the old one's spent state would make it
 * dead on arrival.
 *
 * Returns null rather than throwing when the pickup cannot hold a token, because every caller
 * has a truthful thing to say about that and none of them want an exception.
 */
export async function issueReleaseToken(params: {
  dealId: string;
  now?: Date;
}): Promise<IssuedReleaseToken | null> {
  const now = params.now ?? new Date();

  const pickup = await prisma.pickup.findUnique({
    where: { dealId: params.dealId },
    select: { id: true, status: true, scheduledAt: true, deal: { select: { status: true } } },
  });
  if (!pickup) return null;
  if (!(TOKEN_MINTABLE_STATUSES as readonly string[]).includes(pickup.status)) return null;
  if (!(TOKEN_MINTABLE_DEAL_STATUSES as readonly string[]).includes(pickup.deal.status)) return null;

  const rawToken = generateRawToken();
  const expiresAt = releaseTokenExpiry(pickup.scheduledAt, now);

  await prisma.pickup.update({
    where: { id: pickup.id },
    data: {
      tokenHash: hashToken(rawToken),
      tokenExpiresAt: expiresAt,
      tokenConsumedAt: null,
      tokenRevokedAt: null,
    },
  });

  return { rawToken, expiresAt };
}

/**
 * Resolve a raw token to the one appointment it authorises. READ-ONLY — never consumes, never
 * grants, never writes. A scanner that reads a code twice must not spend it by looking.
 */
export async function resolveReleaseToken(
  rawToken: string,
  now: Date = new Date(),
): Promise<ReleaseTokenResolution> {
  // Anything that is not 64 lowercase hex characters cannot be one of ours — `generateRawToken`
  // emits exactly 32 bytes, hex-encoded — so refusing here keeps a malformed input from becoming
  // a hash plus a database round trip. A loose `length < 32` guard let a 40-character string
  // through to both.
  if (!RAW_TOKEN_SHAPE.test(rawToken)) return { ok: false, reason: "not_found" };

  const pickup = await prisma.pickup.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    select: {
      id: true, dealId: true, status: true, scheduledAt: true,
      tokenExpiresAt: true, tokenConsumedAt: true, tokenRevokedAt: true,
      deal: { select: { status: true } },
    },
  });
  if (!pickup) return { ok: false, reason: "not_found" };

  // Ordered so the holder is told the TRUEST thing about their code. Spent before revoked
  // before expired: someone who already scanned should hear "already used", not "expired".
  if (pickup.tokenConsumedAt) return { ok: false, reason: "consumed" };
  if (pickup.tokenRevokedAt) return { ok: false, reason: "revoked" };
  if (pickup.tokenExpiresAt && pickup.tokenExpiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }

  // The pickup's own state, re-checked rather than inferred from the token's existence. A
  // pickup cancelled or completed after the token was minted must not still open a car.
  if (!(TOKEN_MINTABLE_STATUSES as readonly string[]).includes(pickup.status)) {
    return { ok: false, reason: "pickup_not_releasable" };
  }

  // And the DEAL's state, for the same reason and one the pickup's status cannot speak for:
  // `cancelDeal` leaves the Pickup row untouched, so a cancelled deal still reads SCHEDULED here.
  // Minting already refuses on this; resolving must too, or a code minted a minute before the
  // cancellation outlives it.
  if (!(TOKEN_MINTABLE_DEAL_STATUSES as readonly string[]).includes(pickup.deal.status)) {
    return { ok: false, reason: "pickup_not_releasable" };
  }

  return {
    ok: true,
    view: {
      pickupId: pickup.id,
      dealId: pickup.dealId,
      status: pickup.status,
      scheduledAt: pickup.scheduledAt,
      expiresAt: pickup.tokenExpiresAt,
    },
  };
}

/**
 * Spend the token that was presented, as a compare-and-swap. Returns true only if THIS call
 * spent THAT token.
 *
 * Two simultaneous scans of the same code both resolve — resolution is a read — and both reach
 * here; exactly one gets `true`. That is what makes the credential single-use under genuine
 * concurrency rather than only in sequence.
 *
 * KEYED ON THE HASH, not just the pickup. Keying on `pickupId` alone means a scan that resolved
 * code C1 stamps `token_consumed_at` on whatever code the row holds when it lands — and a buyer
 * who reveals again between those two moments has replaced C1 with C2. The row would then record
 * that a handover happened on a credential nobody ever presented. Adding the hash makes the
 * swap refuse instead, which is the truthful answer.
 */
export async function consumeReleaseToken(
  params: {
    pickupId: string;
    rawToken: string;
    now?: Date;
  },
  /**
   * PHASE 9 ADDED THE TRANSACTION HANDLE, and the ordering problem it solves is worth naming.
   *
   * Consuming outside the release transaction forces a choice between two wrong orderings.
   * Consume first and a gate that fails inside the transaction (funding withdrawn between the
   * pre-check and the write) has already burned the buyer's code, leaving them re-revealing one
   * for a handover that is still blocked. Record first and a second scan can record a second
   * release before the first has spent the code.
   *
   * Passing the handle removes the choice: the consume and the handover commit together, or
   * neither does. Same idiom as `raiseException(input, tx)` and `enqueueTransactional(input, tx)`.
   */
  db: Pick<typeof prisma, "pickup"> | Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const res = await db.pickup.updateMany({
    where: {
      id: params.pickupId,
      tokenHash: hashToken(params.rawToken),
      tokenConsumedAt: null,
      tokenRevokedAt: null,
    },
    data: { tokenConsumedAt: params.now ?? new Date() },
  });
  return res.count === 1;
}

/**
 * Revoke without re-issuing — for a cancelled or rescheduled pickup, and the hook parity row
 * C24-08b asks Phase 10's cancellation orchestration to call.
 *
 * Distinct from consuming: a consumed token records that a handover HAPPENED, a revoked one
 * records that it will not happen on this credential. Collapsing them would make the pickup
 * record claim a release that never occurred.
 */
export async function revokeReleaseToken(
  dealId: string,
  now: Date = new Date(),
  /**
   * Same handle, same reason as `consumeReleaseToken` above. An Operations-recorded release
   * retires the code in the transaction that records the release, so a rolled-back handover
   * leaves the buyer's code live rather than silently dead.
   */
  db: Pick<typeof prisma, "pickup"> | Prisma.TransactionClient = prisma,
): Promise<boolean> {
  const res = await db.pickup.updateMany({
    where: { dealId, tokenHash: { not: null }, tokenConsumedAt: null, tokenRevokedAt: null },
    data: { tokenRevokedAt: now },
  });
  return res.count === 1;
}

