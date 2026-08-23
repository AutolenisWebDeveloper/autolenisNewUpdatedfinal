// Vehicle offer dealer-invite expiry sweep — runs hourly.
// Auto-marks dealer invitations whose expiresAt is in the past as "expired".
import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("vehicle-offer-expire", async () => {
  const result = await prisma.vehicleOfferDealerInvite.updateMany({
    where: {
      status: { in: ["sent", "opened"] },
      expiresAt: { lt: new Date() },
    },
    data: { status: "expired" },
  });

  logger.info(`[vehicle-offer-expire] Expired ${result.count} dealer invitations`);
  return { expired: result.count };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "vehicle-offer-expire_failed" }, { status: 500 });

  return NextResponse.json({ success: true, expired: run.result.expired });
}
