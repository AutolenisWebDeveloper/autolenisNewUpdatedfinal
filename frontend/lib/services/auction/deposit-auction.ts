// lib/services/auction/deposit-auction.ts
//
// THE DEPOSIT -> AUCTION CARDINALITY, IN ONE PLACE (Phase 6, §13-D39).
//
// Until migration 20261115000000, `auctions.deposit_id` carried an ABSOLUTE unique index and
// `Deposit.auction` was a one-to-one. Nine production sites rested on that guarantee, and four of
// them said so in a comment — "the constraint is the idempotency, not a check". §8c's one free
// relaunch made the guarantee untenable: a retry auction must share the original's deposit, or the
// buyer pays $99 twice.
//
// The guarantee is now "at most one ORIGINAL auction per deposit", enforced by
// `auctions_deposit_id_original_key ... WHERE original_auction_id IS NULL`, plus "at most one
// relaunch per original", enforced by `auctions_original_auction_id_key`.
//
// WHY THIS MODULE EXISTS RATHER THAN NINE INLINE READS. Core rule 11 of
// `autolenis-supabase-postgres`: narrowing a constraint creates correctness requirements in code
// that predates it, and the tests covering the old behaviour keep passing because the old
// behaviour is still legal. Three of the nine sites want "the original", two want "has no auction
// at all", one wants "the live one" — and those are three DIFFERENT queries that a `findFirst` on
// `depositId` cannot distinguish. Writing them once, named, is what stops the next reader guessing.
//
// TypeScript found six of the nine sites for free (`findUnique` on a no-longer-unique field, and
// the to-one traversal, both stop compiling). It could NOT see the three that use `findFirst`,
// `is: null` semantics via a different shape, or no lookup at all — those are the ones this module
// is written for.

import { AuctionStatus, Prisma } from "@prisma/client";

/** §8c: "Operations may source manually, relaunch once without a second $99, or close the request." */
export const RELAUNCH_LIMIT = 1;

/**
 * An auction that can still receive or resolve offers. A deposit may carry at most one of these:
 * the original while it runs, or its single relaunch.
 */
export const LIVE_AUCTION_STATUSES: AuctionStatus[] = [
  AuctionStatus.PENDING,
  AuctionStatus.ACTIVE,
  AuctionStatus.REOPENED,
];

/** An auction that has finished, one way or another. Only these make a deposit relaunch-eligible. */
export const TERMINAL_AUCTION_STATUSES: AuctionStatus[] = [
  AuctionStatus.CLOSED,
  AuctionStatus.EXPIRED,
  AuctionStatus.CANCELLED,
];

/**
 * Accepts the full client or a `$transaction` client. `Prisma.TransactionClient` is
 * `Omit<PrismaClient, ITXClientDenyList>`, so `prisma` itself is assignable to it — one parameter
 * type covers both callers, and the delegate keeps its real generated signature rather than a
 * hand-written approximation that would silently accept a wrong `where`.
 */
export type DepositAuctionDb = Pick<Prisma.TransactionClient, "auction">;

/**
 * THE ORIGINAL auction for a deposit, or null.
 *
 * This is the row the partial unique protects, and it is the correct idempotency anchor for every
 * path that asks "did a prior partial run already create the auction for this deposit?" — the
 * Stripe settlement transaction, the concierge conversion, and launch readiness. A relaunch must
 * never satisfy that question: if it did, a redelivered settlement would see the relaunch, skip
 * creation, and the original would never exist.
 */
export async function findOriginalAuctionForDeposit<T = { id: string }>(
  db: DepositAuctionDb,
  depositId: string,
  select: Record<string, unknown> = { id: true },
): Promise<T | null> {
  return (await db.auction.findFirst({
    where: { depositId, originalAuctionId: null },
    select,
  })) as T | null;
}

/**
 * THE LIVE auction for a deposit, or null — the newest non-terminal row.
 *
 * `orderBy` is not decoration. Once a deposit can carry two auctions, an unordered `findFirst`
 * returns an arbitrary row, and on a relaunched deposit that is as likely to be the dead original
 * as the live retry. The reconciler drives close-on-zero-dealers from this value, so an arbitrary
 * pick can close the wrong auction.
 */
export async function findLiveAuctionForDeposit<T = { id: string }>(
  db: DepositAuctionDb,
  depositId: string,
  select: Record<string, unknown> = { id: true },
): Promise<T | null> {
  return (await db.auction.findFirst({
    where: { depositId, status: { in: LIVE_AUCTION_STATUSES } },
    orderBy: { createdAt: "desc" },
    select,
  })) as T | null;
}

export type RelaunchEligibility =
  | { eligible: true; originalAuctionId: string }
  | { eligible: false; reason: "NO_AUCTION" | "AUCTION_STILL_LIVE" | "RELAUNCH_LIMIT_REACHED" };

/**
 * Can this deposit carry a relaunch right now?
 *
 * Eligible when the deposit has an original auction, nothing on it is still live, and the original
 * has not already been relaunched. "One relaunch" is ALSO enforced by
 * `auctions_original_auction_id_key`, so a concurrent double-relaunch fails at the database rather
 * than racing past this check — this function is the readable form and the source of the error
 * message, not the protection.
 */
export async function resolveRelaunchEligibility(
  db: DepositAuctionDb,
  depositId: string,
): Promise<RelaunchEligibility> {
  const live = await findLiveAuctionForDeposit(db, depositId);
  if (live) return { eligible: false, reason: "AUCTION_STILL_LIVE" };

  const original = await findOriginalAuctionForDeposit<{ id: string; relaunchCount: number }>(
    db,
    depositId,
    { id: true, relaunchCount: true },
  );
  if (!original) return { eligible: false, reason: "NO_AUCTION" };
  if (original.relaunchCount >= RELAUNCH_LIMIT) {
    return { eligible: false, reason: "RELAUNCH_LIMIT_REACHED" };
  }
  return { eligible: true, originalAuctionId: original.id };
}

/**
 * Does a P2002 name one of the two indexes this migration introduced?
 *
 * Both routes that create an auction on a caller-supplied deposit previously relied on the absolute
 * unique to raise an unhandled P2002 — ugly, but a 500 is a refusal. Under a partial index the same
 * call can now succeed, so the routes carry explicit preconditions; this maps the residual race
 * (two admins relaunching at once) onto a domain error instead of letting it surface as a 500.
 */
export function isDepositAuctionUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = err.meta?.target;
  const names = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return names.some(
    (n) =>
      n.includes("auctions_deposit_id_original_key") ||
      n.includes("auctions_original_auction_id_key") ||
      n.includes("deposit_id") ||
      n.includes("original_auction_id"),
  );
}
