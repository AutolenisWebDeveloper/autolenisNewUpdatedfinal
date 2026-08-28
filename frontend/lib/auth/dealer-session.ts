// lib/auth/dealer-session.ts
// Dealer authentication using dealer_token JWT cookie (mirrors admin-session.ts pattern).
// The dealer_token is issued by POST /api/dealer/auth/signin after Supabase credential verification.

import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { verifyDealerJwt, DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";
import {
  dealerScope,
  shouldRedirectToOnboarding,
  ONBOARDING_PATH,
  type DealerScope,
} from "@/lib/auth/dealer-scope";
import type { Dealer, User } from "@prisma/client";

export type DealerWithUser = Dealer & { user: User };

/**
 * Statuses that must not have ANY portal access.
 *
 * PENDING is deliberately NOT here. A PENDING dealer has been approved to
 * onboard and holds an ONBOARDING-scoped session; blocking it outright is the
 * circular deadlock (approved -> PENDING -> cannot sign in -> cannot reach
 * onboarding -> never becomes ACTIVE). Scope, not blocking, is what confines a
 * PENDING dealer to /dealer/onboarding — see lib/auth/dealer-scope.ts.
 */
const BLOCKED_STATUSES = new Set(["SUSPENDED", "TERMINATED"]);

// Server-component helper: reads dealer_token cookie from Next.js headers
export async function getAuthenticatedDealer(): Promise<DealerWithUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEALER_TOKEN_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifyDealerJwt(token);
  if (!payload) return null;

  const dealer = await prisma.dealer.findUnique({
    where: { id: payload.dealerId },
    include: { user: true },
  });

  // Return null for blocked statuses so requireDealer() redirects to sign-in
  if (!dealer || BLOCKED_STATUSES.has(dealer.status)) return null;

  return dealer;
}

// API route helper: reads dealer_token cookie from NextRequest
export async function requireDealerFromRequest(request: NextRequest): Promise<DealerWithUser | null> {
  const token = request.cookies.get(DEALER_TOKEN_COOKIE)?.value;
  if (!token) return null;

  const payload = await verifyDealerJwt(token);
  if (!payload) return null;

  const dealer = await prisma.dealer.findUnique({
    where: { id: payload.dealerId },
    include: { user: true },
  });

  if (!dealer || BLOCKED_STATUSES.has(dealer.status)) return null;

  return dealer;
}

/** Current dealer's scope, derived from the live row (never from a JWT claim). */
export async function getDealerScope(): Promise<DealerScope> {
  return dealerScope(await getAuthenticatedDealer());
}

/**
 * Require dealer authentication for a PORTAL page.
 *
 * - no session            → /dealer/sign-in
 * - ONBOARDING scope on a non-onboarding path → /dealer/onboarding
 * - ONBOARDING scope on an onboarding path    → allowed (this is what breaks the
 *   redirect loop: the onboarding page lives under this same layout)
 *
 * The pathname comes from the `x-pathname` request header that proxy.ts already
 * forwards. If it is absent we render rather than redirect (fail open to
 * onboarding) — see shouldRedirectToOnboarding().
 */
export async function requireDealer(): Promise<DealerWithUser> {
  const dealer = await getAuthenticatedDealer();
  if (!dealer) redirect("/dealer/sign-in");

  const h = await headers();
  const pathname = h.get("x-pathname");
  if (shouldRedirectToOnboarding(dealerScope(dealer), pathname)) {
    redirect(ONBOARDING_PATH);
  }

  return dealer;
}

/**
 * Require a dealer who may work on ONBOARDING — admits both ONBOARDING and FULL
 * scope. Used by the onboarding page and its API so a PENDING dealer can finish
 * what admin approval authorized them to start.
 */
export async function requireDealerForOnboarding(): Promise<DealerWithUser> {
  const dealer = await getAuthenticatedDealer();
  if (!dealer) redirect("/dealer/sign-in");
  return dealer;
}

/**
 * API-route variant of the onboarding gate. Returns the dealer for ONBOARDING or
 * FULL scope, or null when there is no usable session.
 */
export async function requireOnboardingDealerFromRequest(
  request: NextRequest,
): Promise<DealerWithUser | null> {
  return requireDealerFromRequest(request);
}

// Variant that does NOT enforce the password-change redirect — used by
// pages that need dealer auth without triggering extra redirects.
export async function requireDealerAllowSetPassword(): Promise<DealerWithUser> {
  const dealer = await getAuthenticatedDealer();
  if (!dealer) redirect("/dealer/sign-in");
  return dealer;
}
