// lib/auth/dealer-session.ts
// Dealer authentication using dealer_token JWT cookie (mirrors admin-session.ts pattern).
// The dealer_token is issued by POST /api/dealer/auth/signin after Supabase credential verification.

import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { verifyDealerJwt, DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";
import type { Dealer, User } from "@prisma/client";

export type DealerWithUser = Dealer & { user: User };

/** Statuses that must not have portal access */
const BLOCKED_STATUSES = new Set(["SUSPENDED", "TERMINATED", "PENDING"]);

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

// Require dealer authentication — redirects to /dealer/sign-in if not authenticated.
export async function requireDealer(): Promise<DealerWithUser> {
  const dealer = await getAuthenticatedDealer();
  if (!dealer) redirect("/dealer/sign-in");
  return dealer;
}

// Variant that does NOT enforce the password-change redirect — used by
// pages that need dealer auth without triggering extra redirects.
export async function requireDealerAllowSetPassword(): Promise<DealerWithUser> {
  const dealer = await getAuthenticatedDealer();
  if (!dealer) redirect("/dealer/sign-in");
  return dealer;
}
