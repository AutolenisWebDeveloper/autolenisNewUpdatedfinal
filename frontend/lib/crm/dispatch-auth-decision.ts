// Auth-precedence decision for inbound Make.com dispatches.
// Kept in its own dependency-free module (no next/server, prisma, or supabase
// imports — `crypto` only) so the two-path auth decision is unit-testable in
// isolation, mirroring dispatch-idempotency.ts.
//
// Precedence (first present credential wins):
//   1. X-AutoLenis-Signature → HMAC-SHA256 over the RAW body (PRIMARY, for code
//      callers). The compare is unchanged from the original inline logic.
//   2. X-Dispatch-Key        → constant-time compare against CRM_DISPATCH_KEY
//      (for Make's plain HTTP module — no client-side signing).
//   3. neither                → missing_auth.
//
// This module ONLY decides authentication. Replay (timestamp skew), idempotency,
// and the rate limit are enforced by authorizeDispatch AFTER this decision and
// apply identically to BOTH paths.
import crypto from 'crypto';

export type DispatchAuthDecision =
  | { ok: true; method: 'hmac' | 'static_key' }
  | { ok: false; reason: 'bad_signature' | 'bad_key' | 'missing_auth' | 'dispatch_not_configured' };

// Constant-time string compare. Hash both sides to a fixed 32-byte digest first
// so timingSafeEqual never throws on a length mismatch (which would itself leak
// length via the exception path). Used for BOTH the HMAC hex compare and the
// static-key compare — never `===`.
export function timingSafeStrEqual(a: string, b: string): boolean {
  const ah = crypto.createHash('sha256').update(a).digest();
  const bh = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export function decideDispatchAuth(input: {
  signatureHeader: string | null;
  dispatchKeyHeader: string | null;
  rawBody: string;
  hmacSecret: string | undefined;
  staticKey: string | undefined;
}): DispatchAuthDecision {
  const { signatureHeader, dispatchKeyHeader, rawBody, hmacSecret, staticKey } = input;

  // 1. HMAC path — PRIMARY. Unchanged compare: HMAC-SHA256 over the raw body,
  //    hex, constant-time. Presence of the signature header selects this path.
  if (signatureHeader) {
    if (!hmacSecret) return { ok: false, reason: 'dispatch_not_configured' };
    const expected = crypto.createHmac('sha256', hmacSecret).update(rawBody).digest('hex');
    if (!timingSafeStrEqual(signatureHeader, expected)) {
      return { ok: false, reason: 'bad_signature' };
    }
    return { ok: true, method: 'hmac' };
  }

  // 2. Static-key path — for Make. Constant-time compare against CRM_DISPATCH_KEY.
  //    The key value is never logged or echoed.
  if (dispatchKeyHeader) {
    if (!staticKey) return { ok: false, reason: 'dispatch_not_configured' };
    if (!timingSafeStrEqual(dispatchKeyHeader, staticKey)) {
      return { ok: false, reason: 'bad_key' };
    }
    return { ok: true, method: 'static_key' };
  }

  // 3. No credential presented.
  return { ok: false, reason: 'missing_auth' };
}
