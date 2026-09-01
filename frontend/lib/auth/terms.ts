// lib/auth/terms.ts — the single source of truth for terms acceptance.
//
// Six production call sites previously each resolved the current terms version
// with their own `process.env.CURRENT_TERMS_VERSION ?? "2026-01-01"` literal:
// the edge gate in proxy.ts, the server-side backstop in app/buyer/layout.tsx,
// acceptTermsAction, the signup metadata stamp, onboarding-complete, and the
// prequal service. Two of those READ the version to decide whether to gate and
// four WRITE it. If the env var were ever unset in ONE runtime (the edge and
// the Node server are configured separately on Vercel), the reader and the
// writer would disagree permanently: accepting would stamp one value while the
// gate rejected anything but the other, and every buyer would be gated forever
// with no way out. Routing all six through this module makes that class of
// split-brain impossible — they cannot disagree because they ask the same
// function.
//
// This module is intentionally dependency-free (no Prisma, no Node built-ins)
// so proxy.ts can import it in the edge runtime.

/**
 * Fallback used ONLY when CURRENT_TERMS_VERSION is unset or blank.
 *
 * It deliberately matches the value production actually stamps ("1.0.0"), so a
 * missing env var degrades to AGREEING with the acceptance rows already on
 * disk rather than invalidating every one of them. The previous "2026-01-01"
 * literal matched no stored value at all, which is what made an unset env var
 * an unrecoverable lockout instead of a no-op.
 */
export const FALLBACK_TERMS_VERSION = "1.0.0";

/** The terms version currently in force. Never read the env var directly. */
export function getCurrentTermsVersion(): string {
  const raw = process.env.CURRENT_TERMS_VERSION;
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  return trimmed.length > 0 ? trimmed : FALLBACK_TERMS_VERSION;
}

/**
 * The ONE predicate every terms gate uses, so the edge gate and the server-side
 * backstop can never reach opposite conclusions about the same buyer.
 *
 * Re-gates when terms were never accepted, or were accepted under a version
 * that is no longer current. A null/undefined stored version is treated as
 * still-valid (it predates version stamping) rather than as a mismatch — the
 * same semantics the previous inline checks had.
 */
export function needsTermsAcceptance(
  acceptedAt: Date | string | null | undefined,
  acceptedVersion: string | null | undefined,
): boolean {
  if (!acceptedAt) return true;
  if (acceptedVersion != null && acceptedVersion !== getCurrentTermsVersion()) return true;
  return false;
}
