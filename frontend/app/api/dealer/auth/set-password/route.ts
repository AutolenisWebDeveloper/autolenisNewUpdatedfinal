// POST /api/dealer/auth/set-password
// Allows an authenticated dealer to update their password.
// Used by SetPasswordClient after a dealer logs in with a temporary password.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getRequestDealer } from "@/lib/auth/dealer-api";
import { signDealerJwt, DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";
import { createClient } from "@supabase/supabase-js";

const schema = z.object({
  newPassword: z
    .string()
    .min(12, "Password must be at least 12 characters.")
    .max(128, "Password must be under 128 characters.")
    .regex(
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number."
    ),
});

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) {
    return NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "Not authenticated" } },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: { code: "INVALID_JSON", message: "Invalid request body" } },
      { status: 400 }
    );
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: parsed.error.issues[0]?.message ?? "Invalid input",
        },
      },
      { status: 400 }
    );
  }

  const { newPassword } = parsed.data;

  try {
    const supabaseAdmin = adminClient();
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      dealer.user.supabaseId,
      { password: newPassword }
    );

    if (error) {
      return NextResponse.json(
        { error: { code: "PASSWORD_UPDATE_FAILED", message: "Could not update password. Please try again." } },
        { status: 400 }
      );
    }

    // Re-issue a fresh dealer_token cookie. The new token has a fresh `iat`,
    // and overwriting the cookie on this device clears any stale value here.
    // Note: any sessions on other devices using the old token remain valid for
    // their original TTL (acceptable risk for MVP — full passwordChangedAt
    // session revocation requires a schema migration).
    const freshToken = await signDealerJwt({
      dealerId: dealer.id,
      userId: dealer.userId,
      email: dealer.user.email,
      role: "DEALER",
    });

    const response = NextResponse.json({ success: true });
    response.cookies.set(DEALER_TOKEN_COOKIE, freshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } },
      { status: 500 }
    );
  }
}
