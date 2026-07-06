// lib/payments/deposit-state.ts — explicit deposit lifecycle transition matrix.
//
// Replaces ad-hoc pairwise out-of-order guards in the Stripe webhook with one
// authoritative allowed-transition set. Stripe delivers events out of order and
// redelivers, so every status write must be validated against this matrix:
// unknown or disallowed transitions FAIL CLOSED (the write is skipped and the
// caller is told it was rejected), never silently applied.

export type DepositStatus = "PENDING" | "PAID" | "FAILED" | "REFUNDED";

// Terminal states never transition out.
const TERMINAL: ReadonlySet<DepositStatus> = new Set(["FAILED", "REFUNDED"]);

// from → set of permitted next states. PAID is non-terminal only because a paid
// deposit can still be refunded.
const ALLOWED: Record<DepositStatus, ReadonlySet<DepositStatus>> = {
  PENDING: new Set(["PAID", "FAILED"]),
  PAID: new Set(["REFUNDED"]),
  FAILED: new Set(),
  REFUNDED: new Set(),
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
