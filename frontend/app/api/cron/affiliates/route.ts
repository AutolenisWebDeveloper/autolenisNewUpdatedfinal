// affiliates — process pending commissions hourly
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("affiliates", async () => {
  // Move PENDING commissions to APPROVED for deals completed > 7 days ago
  const cutoff = new Date(Date.now() - 7 * 24 * 3600000);
  const result = await prisma.commission.updateMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    data: { status: "APPROVED" },
  });
  return { approved: result.count };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "affiliates_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
