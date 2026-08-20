// Vehicle offer dealer-invite expiry sweep — runs hourly.
// Auto-marks dealer invitations whose expiresAt is in the past as "expired".
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

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
