// Dealer session scope — the single place that answers "how much of the dealer
// portal may this dealer reach right now?".
//
// THE LIFECYCLE MODEL (decided; see docs/dealer-funnel-remediation-plan.md §2):
// admin approval of a DealerApplication grants PERMISSION TO ONBOARD, not portal
// access. The dealer stays PENDING and holds an onboarding-scoped session: only
// /dealer/onboarding and its API are reachable. ACTIVE is set exactly once, when
// the agreement step records a signature.
//
// Scope is DERIVED from Dealer.status on every request — never stored, never read
// from a JWT claim as an authorization decision. A stale token can therefore widen
// nothing: the server re-derives from the row it just read.

export type DealerScope = "NONE" | "ONBOARDING" | "FULL";

export const ONBOARDING_PATH = "/dealer/onboarding";
export const ONBOARDING_API_PATH = "/api/dealer/onboarding";

/**
 * Dealer routes reachable WITHOUT a dealer session — sign-in and the
 * token-authenticated claim links. Canonical list, imported by BOTH proxy.ts
 * (edge gate) and app/dealer/layout.tsx (server gate), so the two cannot drift.
 *
 * The layout used to detect these via an `x-dealer-auth-route` header that
 * proxy.ts sets on the RESPONSE; a Server Component's headers() reads the
 * REQUEST, so that signal is not reliably observable. Matching on the forwarded
 * `x-pathname` request header removes the ambiguity.
 */
export const DEALER_PUBLIC_ROUTES = [
  "/dealer/signin",
  "/dealer/sign-in",
  "/dealer/claim",
  "/api/dealer/claim",
  "/dealer/invite/claim",
  "/dealer/invite/complete",
  "/dealer/forgot-password",
  "/dealer/reset-password",
  // Public application entry. It only redirects to /dealer-application now, but
  // it still renders under app/dealer/layout.tsx, so without this an anonymous
  // visitor would be bounced to sign-in before the redirect ever ran.
  "/dealer/apply",
] as const;

/** Does this path reach a dealer surface that must work with no dealer session? */
export function isDealerPublicRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return DEALER_PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(`${r}/`));
}

/**
 * Derive the scope for a dealer row.
 *   PENDING              → ONBOARDING (may complete onboarding, nothing else)
 *   ACTIVE               → FULL
 *   SUSPENDED/TERMINATED → NONE (deliberately terminal)
 */
export function dealerScope(dealer: { status: string } | null | undefined): DealerScope {
  if (!dealer) return "NONE";
  if (dealer.status === "PENDING") return "ONBOARDING";
  if (dealer.status === "ACTIVE") return "FULL";
  return "NONE";
}

/** Is this pathname the onboarding page or one of its children? */
export function isOnboardingPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === ONBOARDING_PATH || pathname.startsWith(`${ONBOARDING_PATH}/`);
}

/** Is this pathname the onboarding API (the only API an ONBOARDING scope may call)? */
export function isOnboardingApiPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === ONBOARDING_API_PATH || pathname.startsWith(`${ONBOARDING_API_PATH}/`);
}

/**
 * Should a request for `pathname` at `scope` be redirected to onboarding?
 *
 * FAIL OPEN TO ONBOARDING: when the pathname is unknown (the `x-pathname` header
 * was stripped by the hosting layer) we return false — render rather than
 * redirect. Redirecting on an unknown path is how this design would produce an
 * infinite loop on /dealer/onboarding itself, which is strictly worse than
 * briefly rendering a page the server-side status check will still gate.
 */
export function shouldRedirectToOnboarding(
  scope: DealerScope,
  pathname: string | null | undefined,
): boolean {
  if (scope !== "ONBOARDING") return false;
  if (!pathname) return false;
  return !isOnboardingPath(pathname);
}
