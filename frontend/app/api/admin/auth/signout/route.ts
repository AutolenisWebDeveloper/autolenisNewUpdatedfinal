import { NextResponse } from "next/server";
import { ADMIN_TOKEN_COOKIE, ADMIN_PREMFA_COOKIE } from "@/lib/admin-auth";

export async function POST() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(ADMIN_TOKEN_COOKIE);
  res.cookies.delete(ADMIN_PREMFA_COOKIE);
  return res;
}
