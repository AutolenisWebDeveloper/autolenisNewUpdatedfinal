// GET /api/public/affiliate/unsubscribe?token=xxx
// Toggles weeklyDigestEnabled=false. One-click FTC/CAN-SPAM compliant.
// Public route (no auth) — the token IS the authorization.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token || token.length < 20) {
    return NextResponse.redirect(new URL("/affiliate/unsubscribed?status=invalid", request.url));
  }

  const affiliate = await prisma.affiliate.findUnique({ where: { unsubscribeToken: token } });
  if (!affiliate) {
    return NextResponse.redirect(new URL("/affiliate/unsubscribed?status=invalid", request.url));
  }

  if (!affiliate.weeklyDigestEnabled) {
    return NextResponse.redirect(new URL("/affiliate/unsubscribed?status=already", request.url));
  }

  await prisma.affiliate.update({
    where: { id: affiliate.id },
    data: { weeklyDigestEnabled: false },
  });

  return NextResponse.redirect(new URL("/affiliate/unsubscribed?status=success", request.url));
}
