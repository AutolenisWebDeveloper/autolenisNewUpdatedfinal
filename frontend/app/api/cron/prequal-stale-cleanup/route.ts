import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// Prequal stale-cleanup
//
// Expiry is modelled by `expiresAt` — it is NOT adverse action. Previous
// versions of this cron rewrote every expired record (including formerly
// APPROVED rows) to `DECLINED`, which routed buyers to the FCRA adverse-action
// page and made prequal-purge delete them. That was incorrect on every axis.
//
// Buyer gating (`app/buyer/layout.tsx`, `journey-status`, `isPrequalValid`)
// already reads `decision === "APPROVED" && expiresAt > now`, so an expired
// APPROVED record naturally surfaces the renew flow without any mutation here.
//
// This cron is now observability only — it counts expired records so we can
// alert on backlog, and never writes a `decision` value.
export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) return new NextResponse("Unauthorized", { status: 401 });

  const expiredCount = await prisma.preQualification.count({
    where: { expiresAt: { lt: new Date() } },
  });

  return NextResponse.json({ success: true, data: { expiredCount } });
}
