// lib/payments/settlement-flags.ts
//
// SOURCING_CASE_REPLACES_AUCTION_LAUNCH — the one flag in this phase whose default is a
// deliberate refusal to ship the new behaviour.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY IT DEFAULTS OFF, stated here rather than in a plan document nobody reads at
// three in the morning.
//
// Phase 3 removes the only path that currently invites dealers: settlement stops
// creating an Auction and starts opening a sourcing case instead. The replacement —
// launch readiness plus the invitation service — does not exist until Phase 5.
//
// Ship this ON before Phase 5 and every buyer who pays $99 gets an open sourcing case
// and NO DEALER IS EVER INVITED. They have paid for an auction that will not happen,
// and nothing in the system is broken enough to notice: no error, no exception, no
// failed job. Just silence, per buyer, until someone looks.
//
// So the adapter keeps creating and inviting BY DEFAULT. The new path is written,
// tested and reachable in preview; production keeps the old behaviour until Phase 5
// turns this on. §13-D52 owns that flip and Phase 5's scope names it.
//
// THE COUNTER IS NOT DECORATION. Every settlement that takes the legacy path writes a
// LEGACY_PATH_WRITE row, and §8.4's removal criterion is thirty days of zero of them.
// With the flag off that counter is SUPPOSED to be non-zero — the thirty days start at
// the flip, not at Phase 3 acceptance, which is stated in §13-D52 because reading the
// §8.4 row alone would suggest otherwise.
// ─────────────────────────────────────────────────────────────────────────────

export const SOURCING_CASE_FLAG = "SOURCING_CASE_REPLACES_AUCTION_LAUNCH";

/**
 * Strict opt-in, the same shape as `DEPOSIT_SETTLEMENT_RECONCILE_ENABLED`: anything but
 * the exact string "true" leaves it off.
 *
 * Read at CALL TIME, never captured at module load. A cached boolean would mean the
 * flip needed a deploy, and the whole point of an env flag on a money path is that it
 * can be reverted in the console without one (§8.2 Phase 3, Rollback).
 */
export function sourcingCaseReplacesAuctionLaunch(): boolean {
  return process.env[SOURCING_CASE_FLAG] === "true";
}
