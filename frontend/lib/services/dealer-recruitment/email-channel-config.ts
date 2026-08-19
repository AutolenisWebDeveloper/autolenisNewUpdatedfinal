// Phase 4B-2 — dealer outreach email channel configuration checks.
//
// Pure env inspection, deliberately free of any `server-only` / SDK import so it
// can be read from server routes AND from services that run under the test runner
// (e.g. coverage.service, which gates prospect contactability on the channel being
// configured). dealer-email-send re-exports these for existing importers.

// Env vars that MUST be present before any dealer outreach send. A cold /
// misconfigured sending domain torches deliverability, so we refuse to dispatch
// until these are wired up (and the domain is verified in Resend).
// AUTOLENIS_PHYSICAL_ADDRESS is a CAN-SPAM requirement.
export const REQUIRED_EMAIL_ENV_VARS = [
  "DEALER_OUTREACH_FROM_EMAIL",
  "DEALER_OUTREACH_REPLY_TO",
  "AUTOLENIS_PHYSICAL_ADDRESS",
  "RESEND_API_KEY",
] as const;

// Returns the subset of required email env vars that are unset/empty. Empty array
// means the channel is configured.
export function missingEmailEnvVars(): string[] {
  return REQUIRED_EMAIL_ENV_VARS.filter((k) => {
    const v = process.env[k];
    return !v || v.trim().length === 0;
  });
}

// Throws when the sending domain isn't fully configured. Exported for callers that
// prefer fail-fast semantics (scripts / tests); the send path uses
// missingEmailEnvVars() directly to return a structured result instead.
export function assertEmailEnvVars(): void {
  const missing = missingEmailEnvVars();
  if (missing.length > 0) {
    throw new Error(
      `[phase-4b2] Missing required email env vars: ${missing.join(", ")}. ` +
        "Domain warming not configured. Set in Vercel before sending.",
    );
  }
}
