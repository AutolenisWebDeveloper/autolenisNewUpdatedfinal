// proxy.ts — AutoLenis Active Middleware
// This is the ONLY active middleware. Never reference middleware.ts.bak or middleware.ts.txt.
// Handles: CSRF token validation, Supabase session refresh, role-based route protection.
// Hard constraint: proxy.ts is the single source of all middleware logic.

import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { jwtVerify } from "jose";
import { needsTermsAcceptance } from "@/lib/auth/terms";
import {
  ONBOARDING_PATH,
  DEALER_PUBLIC_ROUTES,
  isOnboardingPath,
  isOnboardingApiPath,
} from "@/lib/auth/dealer-scope";

// Per-system JWT secrets. Each prefers its dedicated secret and falls back to
// the shared JWT_SECRET — mirroring lib/admin-auth.ts and lib/dealer-auth.ts
// exactly so the edge validators agree with the signers. Until ops sets the
// dedicated secrets, both resolve to JWT_SECRET (no behavioural change).
const SHARED_JWT_SECRET = process.env.JWT_SECRET ?? "placeholder-must-set-jwt-secret-in-env";
const ADMIN_JWT_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET ?? SHARED_JWT_SECRET
);
const DEALER_JWT_SECRET = new TextEncoder().encode(
  process.env.DEALER_JWT_SECRET ?? SHARED_JWT_SECRET
);
const ADMIN_JWT_ISSUER = "autolenis-admin";
const ADMIN_TOKEN_COOKIE = "admin_token";
const DEALER_TOKEN_COOKIE = "dealer_token";
const DEALER_JWT_ISSUER = "autolenis-dealer";

// Admin JWT validator for proxy layer.
// Checks the admin_token cookie FIRST so an active admin session survives
// Supabase session expiry without bouncing the operator back to signin.
// Returns true only if token valid + mfaVerified.
async function hasValidAdminSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(ADMIN_TOKEN_COOKIE)?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, ADMIN_JWT_SECRET, { issuer: ADMIN_JWT_ISSUER });
    return payload.mfaVerified === true;
  } catch {
    return false;
  }
}

/**
 * Verified dealer JWT claims, or null. `scope` mirrors the dealer's scope at mint
 * time and drives the edge routing decision only — the authoritative check
 * re-derives from Dealer.status server-side (lib/auth/dealer-session.ts). A token
 * minted before `scope` existed has no claim; treat it as full, since the
 * server-side gate still applies.
 */
async function getDealerSessionClaims(
  request: NextRequest,
): Promise<{ scope: "onboarding" | "full" } | null> {
  const token = request.cookies.get(DEALER_TOKEN_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, DEALER_JWT_SECRET, { issuer: DEALER_JWT_ISSUER });
    if (payload.role !== "DEALER") return null;
    return { scope: payload.scope === "onboarding" ? "onboarding" : "full" };
  } catch {
    return null;
  }
}

// ─── Route Classification ─────────────────────────────────────────────────────

const PUBLIC_ROUTES = [
  "/",
  "/how-it-works",
  "/for-buyers",
  "/for-affiliates",
  "/for-dealers",
  "/pricing",
  "/about",
  "/contact",
  "/contract-shield",
  "/faq",
  "/feedback",
  "/refinance",
  "/inventory",
  "/trust",
  "/hope",
  "/dealer-application",
  "/dealer/apply",
  "/legal",
  "/maintenance",
  "/affiliate/register",
  "/affiliate/signin",
  "/affiliate/unsubscribed",
  "/insurance",
  "/status",
  "/testimonials",
  "/compare",
  "/request-a-car",
  "/request-vehicle",
  "/dealer-offer",
  "/dealer-offer-outside",
  "/buyer-offer-review",
  "/lp",
  "/thank-you",
  // Hybrid SEO landing system — organic state hub + programmatic city pages.
  "/car-buying-service",
  // Public content/SEO routes — author bios, buying guides, and free tools.
  // Each entry also covers its subpaths via the startsWith(r + "/") check below.
  "/author",
  "/buying-guide",
  // AMIPS market-intelligence pages (data-narration engine, Tier A–F).
  "/intelligence",
  "/tools",
  // Twilio voice/SMS webhooks — cannot present a session/CSRF token; each
  // handler validates the X-Twilio-Signature instead.
  "/api/twilio/voice/incoming",
  "/api/twilio/voice/process",
  "/api/twilio/voice/fallback",
  "/api/twilio/voice/status",
  "/api/twilio/sms/incoming",
  "/guide",
  "/api/leads",
  // SEO crawler files — sitemaps + robots must be reachable without a session.
  // Each is an exact public path; the startsWith(r + "/") check is harmless here.
  "/sitemap.xml",
  "/sitemap-intelligence.xml",
  "/sitemap-intelligence-a.xml",
  "/sitemap-intelligence-b.xml",
  "/sitemap-intelligence-c.xml",
  "/sitemap-intelligence-d.xml",
  "/robots.txt",
  "/sitemap-buyer.xml",
  "/sitemap-dealer.xml",
  "/sitemap-city.xml",
  "/sitemap-cities.xml",
];

const AUTH_ROUTES = [
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
];

const ADMIN_AUTH_ROUTES = [
  "/admin/auth/signin",
  "/admin/auth/setup-mfa",
  "/admin/auth/verify-mfa",
];

// Canonical list lives in lib/auth/dealer-scope.ts so proxy.ts (edge gate) and
// app/dealer/layout.tsx (server gate) can never disagree about which dealer
// routes are reachable without a session.
const DEALER_AUTH_ROUTES = [...DEALER_PUBLIC_ROUTES];

const PORTAL_PREFIXES = {
  buyer: "/buyer",
  dealer: "/dealer",
  affiliate: "/affiliate/portal",
  admin: "/admin",
} as const;

// Role to portal mapping
const ROLE_PORTAL_MAP: Record<string, string> = {
  BUYER: "/buyer/dashboard",
  DEALER: "/dealer/dashboard",
  AFFILIATE: "/affiliate/portal/dashboard",
  SUPER_ADMIN: "/admin/dashboard",
  OPERATIONS_ADMIN: "/admin/dashboard",
  COMPLIANCE_ADMIN: "/admin/dashboard",
  FINANCE_ADMIN: "/admin/dashboard",
  SUPPORT_ADMIN: "/admin/dashboard",
};

// ─── Route Guards ─────────────────────────────────────────────────────────────

function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))) {
    return true;
  }
  // Static assets and Next.js internals
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) {
    return true;
  }
  // SEO files — must be publicly accessible
  if (
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/manifest.webmanifest" ||
    pathname === "/manifest.json"
  ) {
    return true;
  }
  return false;
}

function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

function isAdminAuthRoute(pathname: string): boolean {
  return ADMIN_AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

function isDealerAuthRoute(pathname: string): boolean {
  return DEALER_AUTH_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));
}

/**
 * Dealer paths that carry their own token credential and are therefore exempt
 * from the dealer-session requirement. Exported for test only via
 * `__routeTestHooks` — the runtime decision stays inline in the handler below.
 */
function isTokenExemptDealerPath(pathname: string): boolean {
  return (
    pathname.startsWith("/dealer/invite/claim") ||
    pathname.startsWith("/dealer/invite/complete")
  );
}

/** Test seam — route predicates only, no request handling. */
export const __routeTestHooks = {
  isPublicRoute,
  isDealerAuthRoute,
  isTokenExemptDealerPath,
};

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

function isCronRoute(pathname: string): boolean {
  return pathname.startsWith("/api/cron/");
}

// ─── CSRF Validation ──────────────────────────────────────────────────────────

function validateCsrfToken(request: NextRequest): boolean {
  const method = request.method;

  // CSRF only applies to state-mutating methods
  if (["GET", "HEAD", "OPTIONS"].includes(method)) {
    return true;
  }

  // Skip CSRF for webhooks — they have their own signature validation
  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/webhooks/") || isCronRoute(pathname)) {
    return true;
  }

  // Skip CSRF for Twilio voice/SMS webhooks — Twilio cannot send a CSRF token;
  // each handler validates the X-Twilio-Signature header instead.
  if (pathname.startsWith("/api/twilio/")) {
    return true;
  }

  // Skip CSRF for Make.com inbound dispatch — these are server-to-server calls
  // that cannot present a CSRF token. Each handler validates the
  // X-AutoLenis-Signature HMAC (CRM_DISPATCH_SECRET) + timestamp skew + DB-level
  // idempotency in lib/crm/dispatch-auth.ts before acting.
  if (pathname.startsWith("/api/crm/dispatch/")) {
    return true;
  }

  // Skip CSRF for admin auth routes — bootstrap session from zero (no prior CSRF token exists)
  if (pathname.startsWith("/api/admin/auth/")) {
    return true;
  }

  // Skip CSRF for public auth routes — first request, no session cookie yet
  if (pathname.startsWith("/api/auth/")) {
    return true;
  }

  // Skip CSRF for public API routes — no authenticated session to protect
  if (pathname.startsWith("/api/public/")) {
    return true;
  }

  // Skip CSRF for public AI concierge — anonymous visitors
  // have no authenticated session; session security is
  // enforced via crypto.randomUUID() sessionId minted
  // client-side
  if (pathname.startsWith("/api/concierge")) {
    return true;
  }

  // Skip CSRF for public finder fallback (same reason)
  if (pathname.startsWith("/api/finder")) {
    return true;
  }

  // Skip CSRF for Twilio inbound SMS webhook — validated
  // by Twilio HMAC signature in the request body, not CSRF
  if (pathname.startsWith("/api/twilio/sms/inbound")) {
    return true;
  }

  // Skip CSRF for role-specific API routes — protected by Supabase session auth
  // in each route handler via getRequestBuyer / getRequestDealer / getRequestAffiliate.
  // The Supabase session cookie is HttpOnly and SameSite=Lax, which already mitigates
  // cross-site request forgery for these authenticated routes.
  if (
    pathname.startsWith("/api/buyer/") ||
    pathname.startsWith("/api/dealer/") ||
    pathname.startsWith("/api/affiliate/") ||
    pathname.startsWith("/api/admin/")
  ) {
    return true;
  }

  const csrfHeader = request.headers.get("X-CSRF-Token");
  const csrfCookie = request.cookies.get("csrf-token")?.value;

  if (!csrfHeader || !csrfCookie) {
    return false;
  }

  return csrfHeader === csrfCookie;
}

// ─── Cron Route Protection ────────────────────────────────────────────────────

function validateCronRequest(request: NextRequest): boolean {
  const authHeader = request.headers.get("Authorization");
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) return false;
  if (!authHeader) return false;

  return authHeader === `Bearer ${expectedToken}`;
}

// ─── /auth/accept-terms Enforcement ──────────────────────────────────────────
// This route is enforced here — buyers cannot bypass it by navigating directly.

function requiresTermsAcceptance(
  pathname: string,
  termsAcceptedAt: string | null | undefined,
  termsVersion: string | null | undefined,
): boolean {
  if (!pathname.startsWith("/buyer/")) return false;
  // Delegates to the shared predicate (lib/auth/terms) that app/buyer/layout.tsx
  // and acceptTermsAction also use, so this edge gate and the server-side
  // backstop can never disagree about the same buyer — which is what produced a
  // permanent, invisible redirect loop when each resolved the version itself.
  return needsTermsAcceptance(termsAcceptedAt, termsVersion);
}

// ─── Test Route Gating ────────────────────────────────────────────────────────
// Gap Group 9: /test/* routes and /buyer/demo must be gated in production

function isGatedTestRoute(pathname: string): boolean {
  return (
    pathname.startsWith("/test/") ||
    pathname === "/buyer/demo" ||
    pathname.startsWith("/api/test/")
  );
}

// ─── Main Middleware ──────────────────────────────────────────────────────────

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;

  // Maintenance mode gate — must run before any other check so an outage
  // cannot be bypassed by hitting an authenticated route.
  if (process.env.MAINTENANCE_MODE === "true") {
    // Always allow: static assets, /maintenance page itself, admin auth,
    // provider webhooks, and cron.
    //
    // Webhooks and cron are exempt because a 307 to /maintenance is NOT a
    // delivery a provider can act on: Stripe (and Twilio/DocuSign/Resend) do not
    // follow redirects, so the attempt is recorded as failed and the event is
    // retried until it is abandoned — money-path facts silently lost, with the
    // loss surfacing only in the provider's dashboard. Neither surface is
    // session-authenticated, so exempting them widens nothing: every handler
    // under /api/webhooks/ authenticates its own caller before acting (Stripe
    // and Higgsfield HMAC signatures, Svix for Resend, the Twilio request
    // signature, a shared secret for MicroBilt, the cron secret for
    // content-conversion), and cron routes are checked against the cron secret
    // by step 2 below.
    if (
      !pathname.startsWith("/_next/") &&
      !pathname.startsWith("/api/admin/auth/") &&
      !pathname.startsWith("/api/webhooks/") &&
      !isCronRoute(pathname) &&
      pathname !== "/maintenance"
    ) {
      return NextResponse.redirect(new URL("/maintenance", request.url));
    }
  }

  // Forward the current pathname as a request header so server component layouts
  // can read it via headers() without needing access to the Request object directly.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", pathname);
  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // 0. Affiliate referral attribution — persist ?ref= as a 30-day cookie
  const refCode = request.nextUrl.searchParams.get("ref");
  if (refCode && refCode.length >= 4) {
    response.cookies.set("affiliate_ref", refCode, {
      httpOnly: false, // readable by client JS for confirmation
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });
  }

  // 1. Block test routes in production
  if (
    isGatedTestRoute(pathname) &&
    process.env.NODE_ENV === "production"
  ) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // 2. Validate cron routes
  if (isCronRoute(pathname)) {
    if (!validateCronRequest(request)) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    return response;
  }

  // 3. CSRF validation for mutating API routes
  if (isApiRoute(pathname) && !isCronRoute(pathname)) {
    if (!validateCsrfToken(request)) {
      return new NextResponse(
        JSON.stringify({
          error: { code: "CSRF_INVALID", message: "CSRF token validation failed" },
          correlationId: crypto.randomUUID(),
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    return response;
  }

  // 4. Allow public routes without auth.
  // "/" is intentionally excluded: we let it fall through to the Supabase
  // session check so authenticated buyers can be redirected to the dashboard
  // at the edge without any server-component work on the homepage.
  if (isPublicRoute(pathname) && pathname !== "/") {
    return response;
  }

  // 5. Allow auth routes
  if (isAuthRoute(pathname) || isAdminAuthRoute(pathname) || isDealerAuthRoute(pathname)) {
    // Preserve any cookies already set on `response` (e.g., affiliate_ref from step 0)
    if (isAdminAuthRoute(pathname)) {
      response.headers.set("x-admin-auth-route", "true");
    }
    if (isDealerAuthRoute(pathname)) {
      response.headers.set("x-dealer-auth-route", "true");
    }
    return response;
  }

  // 6. Admin routes — admin JWT first (primary source of truth)
  const isAdminPath = pathname.startsWith("/admin") || pathname.startsWith("/api/admin/");
  if (isAdminPath) {
    if (await hasValidAdminSession(request)) {
      return response;
    }
    if (pathname.startsWith("/api/admin/")) {
      return new NextResponse(
        JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Admin session required" }, correlationId: crypto.randomUUID() }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    return NextResponse.redirect(new URL("/admin/auth/signin", request.url));
  }

  // 6b. Dealer routes — dealer JWT check (mirrors admin pattern)
  const isDealerPath =
    (pathname.startsWith("/dealer") || pathname.startsWith("/api/dealer/")) &&
    !isDealerAuthRoute(pathname);
  if (isDealerPath) {
    const dealerSession = await getDealerSessionClaims(request);
    if (dealerSession) {
      // Onboarding-scoped session: admin approval granted permission to ONBOARD,
      // not portal access. Confine it to onboarding at the edge. This is a
      // routing decision only — lib/auth/dealer-session.ts re-derives scope from
      // the live Dealer.status and is the authoritative gate.
      if (dealerSession.scope === "onboarding") {
        if (pathname.startsWith("/api/dealer/")) {
          if (!isOnboardingApiPath(pathname)) {
            return new NextResponse(
              JSON.stringify({
                error: {
                  code: "ONBOARDING_REQUIRED",
                  message: "Complete onboarding before using the dealer portal.",
                },
                correlationId: crypto.randomUUID(),
              }),
              { status: 403, headers: { "Content-Type": "application/json" } },
            );
          }
          return response;
        }
        if (!isOnboardingPath(pathname)) {
          return NextResponse.redirect(new URL(ONBOARDING_PATH, request.url));
        }
      }
      return response;
    }
    // Token-validated public dealer routes. The token in the emailed link is the
    // credential; each handler validates it. /dealer/claim and /api/dealer/claim
    // are covered by DEALER_AUTH_ROUTES above and never reach this branch.
    if (
      pathname.startsWith("/dealer/invite/claim") ||
      pathname.startsWith("/dealer/invite/complete")
    ) {
      return response;
    }
    if (pathname.startsWith("/api/dealer/")) {
      return new NextResponse(
        JSON.stringify({ error: { code: "UNAUTHENTICATED", message: "Dealer session required" }, correlationId: crypto.randomUUID() }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      );
    }
    return NextResponse.redirect(new URL(`/dealer/sign-in?redirect=${encodeURIComponent(pathname)}`, request.url));
  }

  // 7. Supabase session refresh + role routing (non-admin paths only)
  // Guard: createServerClient throws if env vars are missing (e.g. misconfigured preview
  // deployment). Wrap in try/catch so public pages (especially "/") are always served —
  // the buyer-dashboard redirect is a UX convenience, not a hard requirement.
  let user: User | null = null;
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
            cookiesToSet.forEach(({ name, value, options }) => {
              response.cookies.set(name, value, options);
            });
          },
        },
      }
    );
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    // Supabase unavailable or env vars missing — treat visitor as unauthenticated.
    // Public routes (including "/") will be served normally below.
    user = null;
  }

  // 8. Unauthenticated user — redirect to appropriate sign-in
  //    (admin paths already handled above via section 6)
  //    Public routes (including "/") must still be served for anonymous visitors.
  if (!user) {
    if (isPublicRoute(pathname)) return response;

    // ── Admin preview mode bypass ────────────────────────────────────────────
    // A valid admin_preview_token cookie lets an admin view the buyer portal
    // without a buyer Supabase session. The buyer layout verifies the token
    // again and loads buyer data by the token's buyerId.
    // The admin_preview_token is its own short-lived token family signed with
    // the shared JWT_SECRET (see app/api/admin/buyers/[buyerId]/preview-token
    // and app/buyer/layout.tsx) — NOT the admin/dealer session secret — so it
    // must verify against SHARED_JWT_SECRET to stay consistent with its signer.
    if (pathname.startsWith("/buyer/")) {
      const previewToken = request.cookies.get("admin_preview_token")?.value;
      if (previewToken) {
        try {
          await jwtVerify(previewToken, new TextEncoder().encode(SHARED_JWT_SECRET));
          // Token is valid — let the request reach the buyer layout
          return response;
        } catch {
          // Token invalid or expired — fall through to sign-in redirect
        }
      }
    }
    // ────────────────────────────────────────────────────────────────────────

    return NextResponse.redirect(
      new URL(`/auth/signin?redirect=${encodeURIComponent(pathname)}`, request.url)
    );
  }

  // 9. Redirect authenticated users away from auth pages
  if (isAuthRoute(pathname)) {
    const role = user.user_metadata?.role as string | undefined;
    const destination = role && ROLE_PORTAL_MAP[role]
      ? ROLE_PORTAL_MAP[role]
      : "/";
    return NextResponse.redirect(new URL(destination, request.url));
  }

  // 9a. Authenticated BUYER visiting the public homepage → redirect to dashboard.
  // Runs at edge; keeps the homepage fully static (no force-dynamic needed).
  if (pathname === "/" && user.user_metadata?.role === "BUYER") {
    return NextResponse.redirect(new URL("/buyer/dashboard", request.url));
  }

  // 9b. Suspended buyer attempting to access /buyer/* — redirect to suspension notice.
  // isSuspended is stored in Supabase user_metadata by the suspend/unsuspend API routes
  // so it is available here without a Prisma call (which cannot run at the edge).
  const isBuyerPath =
    pathname.startsWith("/buyer/") &&
    pathname !== "/buyer/suspended" &&
    !pathname.startsWith("/api/buyer/");
  if (isBuyerPath && user.user_metadata?.role === "BUYER" && user.user_metadata?.isSuspended === true) {
    return NextResponse.redirect(new URL("/buyer/suspended", request.url));
  }

  // 9c. Terms acceptance gate
  // termsAcceptedAt is written to user_metadata by acceptTermsAction()
  // via a supabase.auth.admin.updateUserById() call so the edge can read it
  // without a Prisma round-trip.
  const termsAcceptedAt = user.user_metadata?.termsAcceptedAt as string | undefined;
  const termsVersion = user.user_metadata?.termsVersion as string | undefined;
  if (requiresTermsAcceptance(pathname, termsAcceptedAt, termsVersion)) {
    const acceptUrl = new URL("/auth/accept-terms", request.url);
    // Preserve original destination so buyer lands there after accepting
    if (pathname !== "/auth/accept-terms") {
      acceptUrl.searchParams.set("redirect", pathname);
    }
    return NextResponse.redirect(acceptUrl);
  }

  // 10. Affiliate portal canonical enforcement
  // All /affiliate/* authenticated routes redirect to /affiliate/portal/*
  if (
    pathname.startsWith("/affiliate/") &&
    !pathname.startsWith("/affiliate/portal/") &&
    pathname !== "/affiliate/register"
  ) {
    const canonicalPath = pathname.replace("/affiliate/", "/affiliate/portal/");
    return NextResponse.redirect(new URL(canonicalPath, request.url));
  }

  // 11. Legal route canonical enforcement
  if (pathname === "/terms") {
    return NextResponse.redirect(new URL("/legal/terms", request.url));
  }
  if (pathname === "/privacy") {
    return NextResponse.redirect(new URL("/legal/privacy", request.url));
  }

  // 12. System 4C: /buyer/vehicle-requests redirects to /buyer/requests
  if (pathname.startsWith("/buyer/vehicle-requests")) {
    return NextResponse.redirect(
      new URL(pathname.replace("/buyer/vehicle-requests", "/buyer/requests"), request.url)
    );
  }

  return response;
}

// Route matcher — must be exported as `config` so Next.js registers this
// proxy file as active middleware and compiles it into the middleware manifest.
// The pattern below excludes static assets so the proxy function is only
// invoked for real page navigations and API calls, not for every font/chunk/
// image request. All other logic (e.g. /_next/* early-exit) is handled
// inside the proxy function via isPublicRoute().
//
// Excluded path prefixes / patterns:
//   _next/static  — compiled JS/CSS chunks served by Next.js
//   _next/image   — Next.js image optimisation endpoint
//   favicon.ico, favicon.png — browser tab icon
//   robots.txt, sitemap.xml  — crawlers / SEO
//   *.svg|png|jpg|jpeg|gif|webp|ico — static image/icon files in /public
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.png|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
