// POST /api/dealer/auth/signin
// Verifies Supabase credentials, checks Dealer record, issues dealer_token JWT cookie.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { signDealerJwt, DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";
import { limitAuthAttempt, clientIpKey } from "@/lib/security/rate-limit";
import { dealerScope, ONBOARDING_PATH } from "@/lib/auth/dealer-scope";

export async function POST(request: NextRequest) {
  let email: string, password: string, remember: boolean;
  try {
    const body = await request.json();
    email = (body.email as string)?.toLowerCase()?.trim();
    password = body.password as string;
    remember = body.remember === true;
  } catch {
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  if (!email || !password) {
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  // Brute-force guard, keyed by source IP and by target account. Fails OPEN
  // on limiter-store outage (sign-in must never be blocked by our own infra).
  for (const key of [`signin:dealer:ip:${clientIpKey(request.headers)}`, `signin:dealer:email:${email}`]) {
    const rl = await limitAuthAttempt(key);
    if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: rl.status });
  }

  // Verify with Supabase
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  // Find dealer record
  const dealer = await prisma.dealer.findFirst({
    where: { user: { supabaseId: data.user.id } },
    include: { user: true },
  });

  if (!dealer) {
    return NextResponse.json({ error: "Incorrect email or password" }, { status: 401 });
  }

  // Block suspended and terminated dealers before issuing a token
  if (dealer.status === "SUSPENDED") {
    return NextResponse.json(
      { error: "Your dealer account has been suspended. Please contact support@autolenis.com." },
      { status: 403 }
    );
  }
  if (dealer.status === "TERMINATED") {
    return NextResponse.json(
      { error: "Your dealer account has been terminated. Please contact support@autolenis.com." },
      { status: 403 }
    );
  }
  // PENDING is NOT rejected. Admin approval granted permission to onboard, so a
  // PENDING dealer signs in and receives an ONBOARDING-scoped token confining
  // them to /dealer/onboarding. Rejecting here was the circular deadlock:
  // approved -> PENDING -> cannot sign in -> cannot onboard -> never ACTIVE.
  const scope = dealerScope(dealer);
  if (scope === "NONE") {
    return NextResponse.json(
      { error: "Your dealer account is not active. Please contact support@autolenis.com." },
      { status: 403 }
    );
  }

  // Issue dealer JWT — extended TTL when "Remember me" is checked.
  const token = await signDealerJwt({
    dealerId: dealer.id,
    userId: dealer.userId,
    email: dealer.user.email,
    role: "DEALER",
    scope: scope === "ONBOARDING" ? "onboarding" : "full",
  }, { remember });

  const res = NextResponse.json({
    success: true,
    dealerId: dealer.id,
    redirect: scope === "ONBOARDING" ? ONBOARDING_PATH : "/dealer/dashboard",
  });
  res.cookies.set(DEALER_TOKEN_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7, // 30d w/ remember, else 7d
    path: "/",
  });
  return res;
}
