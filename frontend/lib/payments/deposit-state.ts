// lib/payments/deposit-state.ts — explicit deposit lifecycle transition matrix.
//
// Replaces ad-hoc pairwise out-of-order guards in the Stripe webhook with one
// authoritative allowed-transition set. Stripe delivers events out of order and
// redelivers, so every status write must be validated against this matrix:
// unknown or disallowed transitions FAIL CLOSED (the write is skipped and the
// caller is told it was rejected), never silently applied.
//
// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — what `FAILED` means, and why that is the whole fix for defect 1.
//
// It used to mean two incompatible things at once: "the buyer's card was
// declined" and "this deposit is closed". Stripe Elements retries a decline on
// the SAME PaymentIntent, so the first meaning describes a row that is still
// very much alive at the provider, while the second made it unreachable. A buyer
// who was declined once could never reach `PAID`, and — because the webhook
// resolved the deposit row separately from the status write — the auction was
// created, dealers were invited and "deposit received" was emailed anyway, for a
// deposit sitting at `FAILED`. Meanwhile the reconciler swept `PENDING` only, so
// nothing ever found the row again.
//
// `FAILED` now means exactly one thing: THE INTENT IS DEAD. Cancelled, or its
// Checkout Session expired. Nothing can retry out of that, because there is
// nothing left to retry. A decline leaves the deposit `PENDING`, which is the
// truth — the obligation stands and the buyer may still pay it.
//
// `FAILED -> PAID` remains legal regardless, and that is deliberate rather than
// leftover: production already holds rows the old behaviour pushed to `FAILED`
// on a decline, whose intents are still live. Closing the edge would strand
// exactly the buyers this fix exists for.
// ─────────────────────────────────────────────────────────────────────────────

export type DepositStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED" | "DISPUTED";

/** Every label, in `pg_enum` order. Kept exported so tests can iterate exhaustively. */
export const DEPOSIT_STATUSES = ["PENDING", "PAID", "REFUNDED", "FAILED", "DISPUTED"] as const;

// Terminal states never transition out. `REFUNDED` is the only one: the money went
// back, and no later event can make that untrue. `DISPUTED` is explicitly NOT
// terminal — a dispute resolves in one direction or the other and the row must be
// able to follow it. `FAILED` is not terminal either; see the header.
const TERMINAL: ReadonlySet<DepositStatus> = new Set(["REFUNDED"]);

// from → set of permitted next states.
const ALLOWED: Record<DepositStatus, ReadonlySet<DepositStatus>> = {
  // A live intent can succeed, die (cancel/expire), or — if its success webhook
  // was never delivered and the buyer then contested the charge — be disputed
  // straight from here. That last edge looks odd until you have seen it happen:
  // refusing it would leave a contested charge recorded as merely unpaid.
  PENDING: new Set(["PAID", "FAILED", "DISPUTED"]),
  // A paid deposit can be refunded, or contested.
  PAID: new Set(["REFUNDED", "DISPUTED"]),
  // Dead intent. The one way out is the row-repair edge described in the header.
  FAILED: new Set(["PAID"]),
  // Dispute won → the charge stands. Dispute lost → the funds are gone.
  DISPUTED: new Set(["PAID", "REFUNDED"]),
  // Terminal. A dispute filed against an already-refunded charge is a Finance
  // exception, NOT a status rewrite: the money is already back, and overwriting
  // `REFUNDED` would erase the only record of that.
  REFUNDED: new Set([]),
};

export function isTerminalDepositStatus(s: DepositStatus): boolean {
  return TERMINAL.has(s);
}

// Same-state writes are idempotent no-ops (allowed, but callers can skip the
// DB write). Cross-state writes must be in the permitted edge set.
export function canTransitionDeposit(from: DepositStatus, to: DepositStatus): boolean {
  if (from === to) return true;
  return ALLOWED[from]?.has(to) ?? false;
}

// The set of `from` states from which `to` is reachable in one step — used to
// scope an idempotent updateMany so the DB write itself enforces the matrix
// (WHERE status IN <allowedFrom>), closing the check-then-write race.
export function allowedPredecessors(to: DepositStatus): DepositStatus[] {
  return (Object.keys(ALLOWED) as DepositStatus[]).filter(
    (from) => from !== to && ALLOWED[from].has(to),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-EVENT PREDECESSOR SETS.
//
// The matrix says what is LEGAL. It does not say which PROVIDER EVENT may perform
// which edge, and conflating those is a real hazard now that more than one edge
// arrives at `PAID`: `allowedPredecessors("PAID")` includes `DISPUTED`, so a
// handler scoped by it would let a redelivered `payment_intent.succeeded` clear a
// live dispute. Only `charge.dispute.closed` may do that.
//
// So each handler names the states ITS event may act from. These are asserted
// below to be subsets of the matrix, which is what keeps the two from drifting:
// widen the matrix and these stay narrow; narrow the matrix without narrowing
// these and the module refuses to load.
// ─────────────────────────────────────────────────────────────────────────────

/** `payment_intent.succeeded`. Includes `FAILED` for the stranded rows (defect 1). */
export const SETTLE_FROM = ["PENDING", "FAILED"] as const satisfies readonly DepositStatus[];

/** `payment_intent.canceled` and `checkout.session.expired` — the intent is dead. */
export const DEAD_INTENT_FROM = ["PENDING"] as const satisfies readonly DepositStatus[];

/** `charge.dispute.created`. `PENDING` is reachable when the success webhook was missed. */
export const DISPUTE_FROM = ["PENDING", "PAID"] as const satisfies readonly DepositStatus[];

/** `charge.refunded` — including a dispute lost, which returns the funds. */
export const REFUND_FROM = ["PAID", "DISPUTED"] as const satisfies readonly DepositStatus[];

/** `charge.dispute.closed` with the dispute won: the charge stands. */
export const DISPUTE_WON_FROM = ["DISPUTED"] as const satisfies readonly DepositStatus[];

// Load-time integrity check. A per-event set that is not a subset of the matrix is
// a programming error that would silently widen a money-path guard, so it fails the
// import — and therefore the build and every test run — rather than the audit.
for (const [name, from, to] of [
  ["SETTLE_FROM", SETTLE_FROM, "PAID"],
  ["DEAD_INTENT_FROM", DEAD_INTENT_FROM, "FAILED"],
  ["DISPUTE_FROM", DISPUTE_FROM, "DISPUTED"],
  ["REFUND_FROM", REFUND_FROM, "REFUNDED"],
  ["DISPUTE_WON_FROM", DISPUTE_WON_FROM, "PAID"],
] as const) {
  const legal = new Set(allowedPredecessors(to));
  for (const f of from) {
    if (!legal.has(f)) {
      throw new Error(
        `deposit-state: ${name} contains "${f}", which the transition matrix does not allow ` +
          `to reach "${to}". A per-event predecessor set may only ever be NARROWER than the matrix.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// THE FULFILMENT HOLD — one definition, because it is DERIVED rather than stored.
//
// The Phase 1 wave's own migration comment rules it: a deposit is on hold when
// `disputed_at IS NOT NULL AND hold_released_at IS NULL`. A fourth stored column
// (the `dispute_hold_at` that B3/V18 name and that was never created) would be a
// second spelling of the same fact and could disagree with it.
//
// This is the NEGATION — "not on hold" — because that is the shape every caller
// needs: a query for deposits that may unlock fulfilment. Written once here so the
// gate, the fee credit and the upgrade window cannot drift into three different
// readings of the same rule. It is a plain object literal, not a Prisma type, so
// this module stays free of a database import.
// ---------------------------------------------------------------------------
export function depositNotOnHold(): {
  OR: [{ disputedAt: null }, { holdReleasedAt: { not: Date | null } }];
} {
  // A FUNCTION, not a shared constant: a Prisma `where` fragment is spread into a
  // caller's object and Prisma's own types demand a mutable array, so a shared
  // literal would be both readonly-hostile and aliasable by every call site.
  return { OR: [{ disputedAt: null }, { holdReleasedAt: { not: null } }] };
}
