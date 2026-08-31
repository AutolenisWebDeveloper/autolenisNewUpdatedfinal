// lib/ai/kill-switch.ts
// AI kill switch — asserted exactly once, in `lib/ai/provider.ts`, for every
// model call in the application.
//
// TWO TIERS, deliberately:
//
//   1. `AI_KILL_SWITCH=true` (env)   — the HARD stop. Works when the database is
//      down, requires a redeploy to flip. Unchanged from the original module.
//   2. `ai_kill_switch` FeatureFlag  — the SOFT stop. Admin-controlled at
//      runtime through the existing FeatureFlag substrate, no redeploy.
//
// Resolution is `enabled = env !== "true" && !(await isKillFlagSet())`.
//
// Framing the flag as a KILL flag rather than an ENABLE flag is what makes the
// absent-row default correct: `getFeatureFlag` returns `false` for a missing row
// (admin-platform.service.ts), so "no row" means "not killed" — exactly today's
// behaviour. An enable-flag would have disabled all AI on first deploy.
//
// A FeatureFlag READ FAILURE falls back to the env tier alone and logs a
// warning. It never silently disables AI, and it never enables AI when the env
// var says off — the env check runs first, unconditionally.
//
// This module must stay importable from a server context with no side effects.
// It is NEVER imported by a `"use client"` module: `process.env.AI_KILL_SWITCH`
// is not `NEXT_PUBLIC_*`, so in the browser it is `undefined` and `isAiEnabled()`
// always returned `true` — which is why the admin console told operators "Active"
// while AI was disabled (Phase 1 §D.5). `provider-chokepoint.test.ts` asserts no
// client module imports this file.

/** The FeatureFlag key for the runtime (soft) kill switch. */
export const AI_KILL_SWITCH_FLAG = "ai_kill_switch";

/**
 * How long a flag read is reused in-process. Short, because this is a kill
 * switch: a flip must take effect quickly. Serverless instances each hold their
 * own cache, so this is the worst-case propagation delay per instance.
 */
export const KILL_FLAG_CACHE_MS = 10_000;

let flagCache: { value: boolean; readAt: number } | null = null;

/**
 * Drop this instance's memoised flag read. Called by the admin toggle so an
 * operator sees their own flip take effect immediately rather than up to
 * `KILL_FLAG_CACHE_MS` later; other serverless instances converge on their own.
 * Also the reset seam for tests.
 */
export function invalidateKillSwitchCache(): void {
  flagCache = null;
}

/** @deprecated Test-facing alias for {@link invalidateKillSwitchCache}. */
export const __resetKillSwitchCacheForTests = invalidateKillSwitchCache;

/**
 * Tier 1 — the deploy-level hard stop. Synchronous and dependency-free so it
 * still answers when the database is unreachable. Unchanged behaviour: the
 * switch is ON only when explicitly set to "true"; the default is enabled.
 */
export function isAiEnabled(): boolean {
  const killSwitch = process.env.AI_KILL_SWITCH;
  return killSwitch !== "true";
}

export function assertAiEnabled(): void {
  if (!isAiEnabled()) {
    throw new Error("AI_KILL_SWITCH is active — all AI operations are disabled");
  }
}

/** Tier 2 — the runtime flag. `true` means AI is KILLED. Fails to `false`. */
async function isKillFlagSet(): Promise<boolean> {
  const now = Date.now();
  if (flagCache && now - flagCache.readAt < KILL_FLAG_CACHE_MS) return flagCache.value;
  try {
    const { getFeatureFlag } = await import("@/lib/services/admin/admin-platform.service");
    const killed = await getFeatureFlag(AI_KILL_SWITCH_FLAG);
    flagCache = { value: killed, readAt: now };
    return killed;
  } catch (err) {
    // Fall back to the env tier alone. Do NOT cache a failure as "not killed" —
    // the next call retries rather than pinning a degraded answer for 10s.
    const { logger } = await import("@/lib/logger");
    logger.warn(
      "[ai/kill-switch] runtime flag read failed — falling back to AI_KILL_SWITCH env only",
      err,
    );
    return false;
  }
}

/** Both tiers. `false` means every model call must refuse. */
export async function isAiEnabledAsync(): Promise<boolean> {
  if (!isAiEnabled()) return false;
  return !(await isKillFlagSet());
}

/**
 * The assertion `lib/ai/provider.ts` runs before every model call. `purpose` is
 * carried into the thrown message so an operator reading a log knows which
 * capability was refused, not just that "AI is off".
 *
 * The message deliberately contains the literal `AI_KILL_SWITCH` so the existing
 * route-level `catch` blocks — which map `String(err).includes("AI_KILL_SWITCH")`
 * to a 503 `AI_DISABLED` response — keep working unchanged for both tiers.
 */
export async function assertAiEnabledForModelCall(purpose: string): Promise<void> {
  if (await isAiEnabledAsync()) return;
  throw new Error(
    `AI_KILL_SWITCH is active — all AI operations are disabled (refused: ${purpose})`,
  );
}
