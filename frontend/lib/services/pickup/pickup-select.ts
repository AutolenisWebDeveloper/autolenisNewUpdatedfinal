// lib/services/pickup/pickup-select.ts — the Pickup projection that may cross a network boundary.
//
// WHY THIS EXISTS AT ALL. `pickups.token_hash` gained its FIRST writer in this change
// (`release-token.service.ts`). Until now every `include: { pickup: true }` in the repository
// returned that column as `null`, so no reader was wrong — and every one of them would have
// started shipping the hash to a browser the moment the writer landed. That is the §8.1h
// inversion the owner named on 2026-09-16: "check every reader before the writer exists, not
// after." This constant is that check, made structural instead of remembered.
//
// WHY THE HASH MATTERS EVEN THOUGH IT IS A HASH. SHA-256 of a 256-bit CSPRNG token is not
// reversible, so shipping it does not hand anyone a working credential. It does hand them an
// OFFLINE ORACLE: a holder of the hash can test candidate tokens at memory speed with no
// request to us, no rate limit and no log line. Hash-at-rest is a promise that the credential
// cannot be recovered from a database read; a hash on an API response makes the database read
// unnecessary.
//
// THE SHAPE IS `esign-schema-gate.BUYER_SAFE_ENVELOPE_SELECT`'s, deliberately — §11 already
// solved "this row has fields that must not leave the server" for eSign envelopes, and one
// idiom for that problem is worth more than a second, cleverer one.
//
// EVERY Pickup READ IN THE REPOSITORY GOES THROUGH IT — verified by grep, not assumed. That is
// the difference between a constant and a control: a projection applied at the sites somebody
// remembered still leaves the ones they did not. `pickup-select.test.ts` proves the three sets
// partition the model exactly, so a new column fails the suite until it is classified; nothing
// mechanical stops a future `pickup: true`, which is why this paragraph is a claim about today
// rather than a guarantee about tomorrow.
//
// A LEAF ON PURPOSE. `pickup-coordination.service.ts` would be the natural home, but it imports
// `deal.service.ts`, which itself needs this projection — so living there would close an import
// cycle. Nothing is imported here at all.

import { Prisma } from "@prisma/client";

/**
 * Pickup columns that must never leave the server.
 *
 * `qr_code_data` and `qr_code_image` are the retired plaintext credential and its rendered PNG
 * (migration 20261201000000 clears both and no code writes them any more). They are listed here
 * rather than merely unwritten, because "nothing writes it" is a claim about today's code and
 * this is a claim about the wire.
 */
export const PICKUP_SECRET_FIELDS = ["tokenHash", "qrCodeData", "qrCodeImage"] as const;

/**
 * Columns withheld because they have no WRITER any more, not because they are secret.
 *
 * `qr_expires_at` was the stored QR's companion. The dealer scan reads `token_expires_at` now and
 * the buyer's screen reads the expiry off the mint response, so nothing writes this column and
 * nothing reads it. Publishing it anyway would put a value on the wire that is `null` on every
 * new row and a STALE expiry — disagreeing with `token_expires_at` — on any row that predates the
 * change. A field whose only possible contribution is a wrong answer is worse than an absent one.
 *
 * Kept separate from the secret list on purpose: a future reader deciding whether the column can
 * be dropped needs to know these were withheld for tidiness, not for safety. The migration's
 * FOLLOW-UP block drops all four together.
 */
export const PICKUP_RETIRED_FIELDS = ["qrExpiresAt"] as const;

/**
 * Every Pickup scalar EXCEPT the three above.
 *
 * Enumerated rather than derived so that adding a column to the model is a decision someone has
 * to make here — a spread of the DMMF would quietly admit the next secret. `pickup-select.test.ts`
 * proves the two sets partition the model exactly, so a new column fails the suite until it is
 * classified.
 */
export const PICKUP_SAFE_SELECT = {
  id: true,
  dealId: true,
  status: true,
  scheduledAt: true,
  completedAt: true,
  location: true,
  proposedTime: true,
  proposedBy: true,
  proposedAt: true,
  counterCount: true,
  proposedReminderSentAt: true,
  counterReminderSentAt: true,
  createdAt: true,
  updatedAt: true,
  buyerConfirmedAt: true,
  conditionAtRelease: true,
  conditionAtPossession: true,
  dealerReadinessChecklist: true,
  dealerReleasedAt: true,
  deliveryAddress: true,
  dueBillItems: true,
  fulfillmentMode: true,
  fundsCollectedMethod: true,
  identityVerifiedAt: true,
  noShowAt: true,
  noShowParty: true,
  odometerAtPossession: true,
  odometerAtRelease: true,
  possessionDiscrepancy: true,
  readinessConfirmedAt: true,
  releasedBy: true,
  reminder24hSentAt: true,
  reminder2hSentAt: true,
  // The token's STATE is not the token. When it expires, whether it was spent and whether it was
  // revoked are exactly what a buyer's screen and an operator's screen have to say out loud.
  tokenConsumedAt: true,
  tokenExpiresAt: true,
  tokenRevokedAt: true,
  tradeReceivedAt: true,
  vehiclePreparedAt: true,
  vinMatch: true,
} as const satisfies Prisma.PickupSelect;

/** A Pickup row as it is allowed to leave the server. */
export type SafePickup = Prisma.PickupGetPayload<{ select: typeof PICKUP_SAFE_SELECT }>;
