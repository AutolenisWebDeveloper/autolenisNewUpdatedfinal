import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";

// Cron: /api/cron/inventory-stale-sweep — Schedule: */30 * * * * (every 30 min)
// ENH-5: Deactivate stale Lane 2/3 vehicles not seen in 48h
// Registered in vercel.json ✓

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const cutoff = new Date(Date.now() - 48 * 3600000);

  const { count: deactivated } = await prisma.inventoryItem.updateMany({
    where: {
      lastSeenAt: { lt: cutoff },
      lane: { not: "LANE_1" }, // Never auto-deactivate dealer-verified Lane 1
      isActive: true,
    },
    data: { isActive: false },
  });

  return NextResponse.json({ success: true, data: { deactivated, cutoff } });
}
