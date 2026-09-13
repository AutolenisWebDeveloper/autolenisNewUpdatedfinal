// Dealer account-claim endpoint (WO-2).
//
// GET  /api/dealer/claim?token=…  → validate a claim token, return dealership info.
// POST /api/dealer/claim          → set the dealer's password via Supabase, mark
//                                    the token consumed, audit-log, sign the dealer
//                                    JWT, and redirect to onboarding.
//
// The token is single-use, hashed at rest, 7-day expiry. No plaintext password is
// ever stored or returned. Reused / expired tokens are rejected.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { signDealerJwt, DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";
import { getClientIp } from "@/lib/auth/admin-api";
import {
  validateClaimToken,
  consumeClaimToken,
} from "@/lib/services/dealer-recruitment/account-claim.service";
import { linkRooftopInvitationsToDealer } from "@/lib/services/auction/auction-invitation.service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function adminSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

const reasonStatus: Record<string, number> = {
  not_found: 404,
  consumed: 410,
  expired: 410,
};
const reasonMessage: Record<string, string> = {
  not_found: "This claim link is invalid.",
  consumed: "This claim link has already been used. Please sign in.",
  expired: "This claim link has expired. Please contact AutoLenis for a new one.",
};

// Load the dealer + user behind a validated token.
async function loadDealerForToken(dealerId: string) {
  return prisma.dealer.findUnique({
    where: { id: dealerId },
    select: {
      id: true,
      dealershipName: true,
      // Ruling B — the rooftop is how a pre-existing outside invitation is found.
      rooftopId: true,
      user: { select: { id: true, email: true, supabaseId: true } },
    },
  });
}

// ─── GET — validate + preview ────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Token required" }, { status: 400 });

  const v = await validateClaimToken(token);
  if (!v.ok) {
    return NextResponse.json(
      { error: reasonMessage[v.reason], expired: v.reason !== "not_found" },
      { status: reasonStatus[v.reason] }
    );
  }

  const dealer = await loadDealerForToken(v.dealerId);
  if (!dealer) return NextResponse.json({ error: "Dealer not found" }, { status: 404 });

  return NextResponse.json({
    success: true,
    data: {
      dealershipName: dealer.dealershipName,
      email: dealer.user.email,
    },
  });
}

// ─── POST — consume + set password ───────────────────────────────────────────
const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 }
    );
  }
  const { token, password } = parsed.data;

  const v = await validateClaimToken(token);
  if (!v.ok) {
    return NextResponse.json(
      { error: reasonMessage[v.reason], expired: v.reason !== "not_found" },
      { status: reasonStatus[v.reason] }
    );
  }

  const dealer = await loadDealerForToken(v.dealerId);
  if (!dealer?.user.supabaseId) {
    return NextResponse.json({ error: "Dealer account not found" }, { status: 404 });
  }

  // Atomically claim the token first so a double-submit can never set the
  // password twice or hand out two sessions.
  const won = await consumeClaimToken(v.tokenId);
  if (!won) {
    return NextResponse.json(
      { error: reasonMessage.consumed, expired: true },
      { status: 410 }
    );
  }

  // Set the dealer's chosen password via Supabase admin API.
  const supabase = adminSupabase();
  const { error: pwErr } = await supabase.auth.admin.updateUserById(
    dealer.user.supabaseId,
    { password }
  );
  if (pwErr) {
    // Roll the token back so the dealer can retry (it was ours to consume).
    await prisma.dealerAccountClaimToken
      .update({ where: { id: v.tokenId }, data: { consumedAt: null } })
      .catch(() => {});
    logger.error("[dealer/claim] Supabase password set failed:", pwErr.message);
    return NextResponse.json({ error: "Failed to set password. Please try again." }, { status: 500 });
  }

  // Clear the forced-password-change flag now that the dealer set their own.
  await prisma.user
    .update({ where: { id: dealer.user.id }, data: { requiresPasswordChange: false } })
    .catch((err) => logger.error("[dealer/claim] clear requiresPasswordChange failed:", err));

  // RULING B (owner, 2026-09-13) — an outside rooftop that was invited to an auction and has
  // now claimed its account. Its invitation carries `rooftop_id` and a NULL `dealer_id`, and
  // every dealer action scopes on `dealer_id`, so without this the dealer holds an authorised
  // session and still cannot act on the auction it was invited to. Writing the id the gate
  // already reads is a DATA fix, not an authorisation change.
  //
  // NOT inside a database transaction spanning the steps above, deliberately: those steps make
  // a network call to Supabase, and a transaction held open across it is the idle-in-transaction
  // shape that cost migration 109 two `statement_timeout` failures. The linker is atomic and
  // idempotent per row on its own, and runs only once the claim has genuinely succeeded.
  //
  // Non-fatal, like the audit and CRM steps below it: the account IS claimed by this point, and
  // failing the request would tell the dealer their claim did not work when it did. The daily
  // rooftop-resolution pass links any invitation missed here.
  if (dealer.rooftopId) {
    await linkRooftopInvitationsToDealer(dealer.rooftopId, dealer.id).catch((err) =>
      // Both ids, because this is the only record of a link that did not happen: the daily
      // pass selects dealers with a NULL rooftopId, so a dealer who fails here has one and is
      // never revisited. An operator needs to know WHICH rooftop and dealer to reconcile.
      logger.error(
        `[dealer/claim] linking rooftop invitations failed (rooftop ${dealer.rooftopId}, dealer ${dealer.id}):`,
        err,
      ),
    );
  }

  // Audit the self-service claim (no admin actor — system/dealer-self).
  await prisma.adminAuditLog
    .create({
      data: {
        adminId: "system",
        adminEmail: "dealer-self-claim",
        action: "DEALER_ACCOUNT_CLAIMED",
        entityType: "Dealer",
        entityId: dealer.id,
        reason: "Dealer claimed account and set password",
        ipAddress: getClientIp(request),
        metadata: { applicationId: v.applicationId, tokenId: v.tokenId },
      },
    })
    .catch((err) => logger.error("[dealer/claim] audit log failed:", err));

  const jwtToken = await signDealerJwt({
    dealerId: dealer.id,
    userId: dealer.user.supabaseId,
    email: dealer.user.email,
    role: "DEALER",
  });

  const res = NextResponse.json({ success: true, redirect: "/dealer/onboarding" });
  res.cookies.set(DEALER_TOKEN_COOKIE, jwtToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  });
  return res;
}
