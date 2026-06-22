// F-004 — pure commission math, dependency-free so it is unit-testable without
// pulling in the server-only payment/event chain. The commission amount is a
// percentage of the ACTUAL fee the buyer paid, not a hardcoded constant.
export function computeCommissionCents(feeBasisCents: number, rate: number): number {
  if (!Number.isFinite(feeBasisCents) || feeBasisCents <= 0) return 0;
  return Math.round(feeBasisCents * rate);
}
