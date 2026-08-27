// lib/services/ai/action-intent/activation.ts
//
// Dormant + granular activation. The ActionIntent execution architecture ships
// DORMANT: no intent runs until it is explicitly, granularly activated by
// `actor+intent`. Activation ALWAYS fails closed — missing configuration means
// "off", never "on". Enabling one safe read can never implicitly enable a
// mutation or another actor's intents, because each intent has its own key and
// a global master switch must ALSO be on.
//
// The default resolver is env-based so it is fully deterministic and unit
// testable. A FeatureFlag-backed resolver (reusing the existing
// `feature-flags.service`) is provided for the production owner-gated path.

export type ActivationResolver = (activationKey: string) => Promise<boolean>;

const MASTER_ENV = "ACTION_INTENT_EXECUTION_ENABLED";
const KEYS_ENV = "ACTION_INTENT_ACTIVE_KEYS";

/**
 * Parse a comma/space separated allowlist of activation keys from env.
 * Empty/undefined → empty set (nothing active).
 */
export function parseActiveKeys(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(/[,\s]+/)
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

/**
 * Deterministic env-based activation. Requires BOTH:
 *   1. the master switch ACTION_INTENT_EXECUTION_ENABLED === "true", AND
 *   2. the exact `activationKey` present in ACTION_INTENT_ACTIVE_KEYS.
 * Either missing → fail closed (false).
 */
export function envActivationResolver(env: Record<string, string | undefined> = process.env): ActivationResolver {
  return async (activationKey: string): Promise<boolean> => {
    if (env[MASTER_ENV] !== "true") return false;
    const active = parseActiveKeys(env[KEYS_ENV]);
    return active.has(activationKey);
  };
}

/**
 * Production owner-gated resolver: reuses the existing DB FeatureFlag substrate.
 * A per-intent flag key `action_intent:<activationKey>` must be enabled AND the
 * master flag `action_intent:master` must be enabled. Absent flag rows resolve
 * to false (the existing getFeatureFlag default), so this also fails closed.
 * Lazy-imported to keep the core free of service/Prisma deps.
 */
export function featureFlagActivationResolver(): ActivationResolver {
  return async (activationKey: string): Promise<boolean> => {
    const { isEnabled } = await import("@/lib/services/system/feature-flags.service");
    const master = await isEnabled("action_intent:master");
    if (!master) return false;
    return isEnabled(`action_intent:${activationKey}`);
  };
}

/** Convenience: a resolver that is always closed (used as the safe default). */
export const alwaysClosedResolver: ActivationResolver = async () => false;

/**
 * Synchronous master-switch check. When false (the default), the ActionIntent
 * surface is fully dormant: agents receive NO ActionIntent guidance in their
 * prompts, so live chat behavior is byte-for-byte unchanged from before
 * Program 6. Only when the owner flips ACTION_INTENT_EXECUTION_ENABLED=true does
 * the recognition guidance appear (and even then, each intent still needs its
 * own activation key). Fail-closed.
 */
export function isActionIntentSurfaceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[MASTER_ENV] === "true";
}
