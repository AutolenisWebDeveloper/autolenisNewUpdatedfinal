import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

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
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("prequal-stale-cleanup", async () => {
  const expiredCount = await prisma.preQualification.count({
    where: { expiresAt: { lt: new Date() } },
  });
  return { expiredCount };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "prequal-stale-cleanup_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
