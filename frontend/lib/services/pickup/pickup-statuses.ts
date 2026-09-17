// lib/services/pickup/pickup-statuses.ts — the release-code precondition, with ZERO dependencies.
//
// WHY ITS OWN FILE. The list lives with the token service conceptually, but a "use client"
// component needs it too — the admin screens must stop offering "Issue New Pickup Code" on a
// pickup the server will refuse, and a frontend that offers a control the backend rejects is a
// disagreement the user pays for. Importing `release-token.service` into a client bundle would
// drag `@/lib/prisma` in with it. This module imports nothing, so both sides can read the same
// constant instead of keeping two lists in step by memory.
//
// `release-token.service` re-exports it, so nothing server-side has to know this file exists.

/**
 * Pickup statuses a release token may be minted for.
 *
 * NOT_SCHEDULED, PROPOSED and DEALER_COUNTERED are all "no agreed time yet"; COMPLETED,
 * RELEASED, NO_SHOW and EXCEPTION are all "not happening on this code". `regenerateQr` had no
 * status guard at all, so an administrator could mint a live credential for a pickup that was
 * never scheduled — a code that opens a car with no appointment behind it.
 */
export const TOKEN_MINTABLE_STATUSES = ["SCHEDULED", "RESCHEDULED", "CHECKED_IN"] as const;

/** True when a release code may exist for a pickup in this status. */
export function isReleaseCodeIssuable(pickupStatus: string | null | undefined): boolean {
  return !!pickupStatus && (TOKEN_MINTABLE_STATUSES as readonly string[]).includes(pickupStatus);
}
