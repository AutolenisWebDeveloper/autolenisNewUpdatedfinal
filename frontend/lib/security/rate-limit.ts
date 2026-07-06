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
import { logger } from "@/lib/logger";

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
    logger.error(
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
    return res.success
      ? OK
      : { ok: false, status: 429, message: "Too many attempts. Please wait a few minutes and try again." };
  } catch (err) {
    // FAIL OPEN + alert: an outage of the limiter store must not block sign-in.
    logger.error("[rate-limit] auth limiter store unavailable — failing open:", err);
    return OK;
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
    // card-testing surface while the store is down.
    logger.error("[rate-limit] payment limiter store unavailable — failing CLOSED:", err);
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
    return res.success
      ? OK
      : { ok: false, status: 429, message: "Too many requests. Please slow down and try again." };
  } catch (err) {
    logger.error("[rate-limit] general limiter store unavailable — failing open:", err);
    return OK;
  }
}
