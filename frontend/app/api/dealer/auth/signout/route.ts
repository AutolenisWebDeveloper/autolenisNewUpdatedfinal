// POST /api/dealer/auth/signout — clear dealer_token cookie

import { NextResponse } from "next/server";
import { DEALER_TOKEN_COOKIE } from "@/lib/dealer-auth";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.set(DEALER_TOKEN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
