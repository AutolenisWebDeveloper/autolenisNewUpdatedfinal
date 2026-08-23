// lib/security/cron-auth.ts
//
// Single source of truth for authorizing inbound cron / scheduled-job requests.
//
// Security posture (Phase 4 F5): the previous per-route inline check accepted a
// spoofable `x-vercel-cron: 1` header WITHOUT any secret, and — when CRON_SECRET
// was unset — compared against the literal string "Bearer undefined", which an
// attacker could send. Both are removed here:
//   1. CRON_SECRET MUST be configured. If it is missing/empty the request is
//      rejected 500 (FAIL CLOSED) — never degrade to "Bearer undefined".
//   2. Authorization MUST be exactly `Bearer <CRON_SECRET>`. Vercel Cron sends
//      this header automatically when CRON_SECRET is set on the project, so real
//      platform crons keep working; the header-only bypass is gone.
// The comparison is constant-time to avoid leaking the secret via timing.

import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { CRON_AUTH_PREFIX } from "@/lib/constants";

export type CronAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 500; reason: string };

/**
 * Pure authorizer — easy to unit test. Returns ok:true only when a non-empty
 * CRON_SECRET is configured AND the Authorization header exactly equals
 * `Bearer <CRON_SECRET>` (constant-time). Missing secret → 500 (fail closed).
 */
export function evaluateCronAuth(
  authHeader: string | null | undefined,
  secret: string | undefined | null,
): CronAuthResult {
  if (!secret || secret.length === 0) {
    return { ok: false, status: 500, reason: "CRON_SECRET not configured" };
  }
  if (!authHeader) {
    return { ok: false, status: 401, reason: "missing Authorization" };
  }
  const expected = `${CRON_AUTH_PREFIX}${secret}`;
  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  // Length check first — timingSafeEqual throws on length mismatch.
  if (a.length !== b.length) {
    return { ok: false, status: 401, reason: "invalid token" };
  }
  return timingSafeEqual(a, b)
    ? { ok: true }
    : { ok: false, status: 401, reason: "invalid token" };
}

/**
 * Route-level guard. Returns null when the request is authorized; otherwise a
 * NextResponse the handler should return immediately. Reads CRON_SECRET at call
 * time (never at module load) so a rotated secret is honored.
 */
export function authorizeCronRequest(request: {
  headers: { get(name: string): string | null };
}): NextResponse | null {
  const result = evaluateCronAuth(
    request.headers.get("authorization"),
    process.env.CRON_SECRET,
  );
  if (result.ok) return null;
  const body = result.status === 500 ? "Cron auth misconfigured" : "Unauthorized";
  return new NextResponse(body, { status: result.status });
}
