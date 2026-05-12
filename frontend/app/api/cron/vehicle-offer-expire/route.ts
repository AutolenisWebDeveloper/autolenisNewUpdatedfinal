// Vehicle offer dealer-invite expiry sweep — runs hourly.
// Auto-marks dealer invitations whose expiresAt is in the past as "expired".
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const result = await prisma.vehicleOfferDealerInvite.updateMany({
    where: {
      status: { in: ["sent", "opened"] },
      expiresAt: { lt: new Date() },
    },
    data: { status: "expired" },
  });

  console.log(`[vehicle-offer-expire] Expired ${result.count} dealer invitations`);
  return NextResponse.json({ success: true, expired: result.count });
}
