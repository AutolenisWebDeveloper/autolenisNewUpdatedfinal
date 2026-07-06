// lib/security/rate-limit.ts — durable, edge-accessible rate limiting.
//
// Store: Upstash Redis (REST), reachable from Node and Edge runtimes alike.
// Accepts either the Upstash env names or the Vercel KV aliases. NOT a
// per-request DB table — the store round-trip is a single REST call.
//
// Fail modes (owner directive, Phase 0.5):
//   • Auth limiters FAIL OPEN: a limiter/store outage must never lock users
//     out of sign-in. The outage is alerted via logger.error → Sentry.
//   • Payment-intent limiter FAILS CLOSED (degraded): if the store is
//     unreachable we refuse new payment intents with a 503 rather than expose
//     an unthrottled card-testing surface (card-testing → Stripe account risk).
//
// Bootstrap: when NO store is configured at all (env vars absent), both tiers
// pass through unchanged so deploys without the secret keep working — but an
// error is logged (→ Sentry) on first use in production so provisioning is
// impossible to miss. Fail-closed semantics apply to runtime outages of a
// configured store, not to the unconfigured state.

import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { pageOnCall, notifyOncall } from "@/lib/observability/alert";

// Time-boxed fail-open (owner directive): the auth/general tiers stay open
// while the store is down, but only for a bounded window per warm instance —
// after AUTH_FAILOPEN_MAX_MS of continuous outage the tier flips to fail
// CLOSED to bound brute-force exposure. Tracked in module memory: this bounds
// exposure on any warm instance; a cold start resets the window, and a
// cross-instance breaker would require a second (independent) store, which is
// out of scope for launch. now() is read from Date.now (allowed in app code).
function failOpenWindowMs(): number {
  return Number(process.env.RL_FAILOPEN_MAX_MS ?? 5 * 60 * 1000);
}
let authOutageStartedAt: number | null = null;

function evaluateFailOpen(err: unknown, tier: "auth" | "general"): RateLimitResult {
  const now = Date.now();
  if (authOutageStartedAt === null) authOutageStartedAt = now;
  const outageMs = now - authOutageStartedAt;
  const windowMs = failOpenWindowMs();

  if (outageMs > windowMs) {
    // Exposure window exceeded — page and fail CLOSED.
    pageOnCall(`[rate-limit] ${tier} limiter store down > ${Math.round(windowMs / 1000)}s — failing CLOSED`, {
      outageMs,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 503, message: "Service temporarily unavailable. Please try again shortly." };
  }
  // Within the window — page (auth outage is security-relevant) and fail OPEN.
  pageOnCall(`[rate-limit] ${tier} limiter store unavailable — failing OPEN (within ${Math.round(windowMs / 1000)}s window)`, {
    outageMs,
    error: err instanceof Error ? err.message : String(err),
  });
  return OK;
}

function clearOutage(): void {
  authOutageStartedAt = null;
}

export type RateLimitResult =
  | { ok: true }
  | { ok: false; status: 429 | 503; message: string };

const OK: RateLimitResult = { ok: true };

function storeEnv(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

let redis: Redis | null | undefined;
function getRedis(): Redis | null {
  if (redis !== undefined) return redis;
  const env = storeEnv();
  redis = env ? new Redis({ url: env.url, token: env.token }) : null;
  return redis;
}

const limiterCache = new Map<string, Ratelimit>();
function getLimiter(prefix: string, tokens: number, window: `${number} ${"s" | "m" | "h"}`): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  const cacheKey = `${prefix}:${tokens}:${window}`;
  let limiter = limiterCache.get(cacheKey);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: r,
      limiter: Ratelimit.slidingWindow(tokens, window),
      prefix: `rl:${prefix}`,
    });
    limiterCache.set(cacheKey, limiter);
  }
  return limiter;
}

let warnedUnconfigured = false;
function warnUnconfigured(context: string): void {
  if (warnedUnconfigured) return;
  warnedUnconfigured = true;
  if (process.env.NODE_ENV === "production") {
    notifyOncall(
      `[rate-limit] no Redis store configured (UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN) — ${context} is UNTHROTTLED. Provision the store.`,
    );
  }
}

// Extract a stable client IP for keying (first x-forwarded-for hop).
export function clientIpKey(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  return (xff ? xff.split(",")[0].trim() : null) || headers.get("x-real-ip") || "unknown";
}

// ── Auth tier: FAIL OPEN ─────────────────────────────────────────────────────
// Default: 10 attempts / 10 minutes per key. Key by BOTH identifier and IP at
// the call site (two calls) so neither a single account nor a single source
// can be brute-forced.
export async function limitAuthAttempt(
  key: string,
  opts: { tokens?: number; window?: `${number} ${"s" | "m" | "h"}` } = {},
): Promise<RateLimitResult> {
  const limiter = getLimiter("auth", opts.tokens ?? 10, opts.window ?? "10 m");
  if (!limiter) {
    warnUnconfigured("auth rate limiting");
    return OK;
  }
  try {
    const res = await limiter.limit(key);
    clearOutage();
    return res.success
      ? OK
      : { ok: false, status: 429, message: "Too many attempts. Please wait a few minutes and try again." };
  } catch (err) {
    // Time-boxed FAIL OPEN + page: open while the store is briefly down, then
    // flip closed if the outage persists past the window.
    return evaluateFailOpen(err, "auth");
  }
}

// ── Payment tier: FAIL CLOSED on store outage ────────────────────────────────
// Default: 10 intents / hour per key. Key by account AND by IP at call sites.
export async function limitPaymentIntent(
  key: string,
  opts: { tokens?: number; window?: `${number} ${"s" | "m" | "h"}` } = {},
): Promise<RateLimitResult> {
  const limiter = getLimiter("pay", opts.tokens ?? 10, opts.window ?? "1 h");
  if (!limiter) {
    warnUnconfigured("payment-intent rate limiting");
    return OK;
  }
  try {
    const res = await limiter.limit(key);
    return res.success
      ? OK
      : { ok: false, status: 429, message: "Too many payment attempts. Please wait and try again." };
  } catch (err) {
    // FAIL CLOSED (degraded): refuse rather than expose an unthrottled
    // card-testing surface. This sits on the revenue-critical path, so a store
    // outage is a HIGH-severity revenue incident — page, do not merely log.
    pageOnCall("[rate-limit] payment limiter store unavailable — failing CLOSED (checkout blocked)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      status: 503,
      message: "Payment processing is temporarily unavailable. Please try again in a few minutes.",
    };
  }
}

// ── General tier (public endpoints, self-service mutations): FAIL OPEN ──────
export async function limitGeneral(
  key: string,
  opts: { tokens?: number; window?: `${number} ${"s" | "m" | "h"}` } = {},
): Promise<RateLimitResult> {
  const limiter = getLimiter("gen", opts.tokens ?? 20, opts.window ?? "1 h");
  if (!limiter) {
    warnUnconfigured("general rate limiting");
    return OK;
  }
  try {
    const res = await limiter.limit(key);
    clearOutage();
    return res.success
      ? OK
      : { ok: false, status: 429, message: "Too many requests. Please slow down and try again." };
  } catch (err) {
    // Time-boxed FAIL OPEN (same window as the auth tier).
    return evaluateFailOpen(err, "general");
  }
}
