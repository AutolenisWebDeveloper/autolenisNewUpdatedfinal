// affiliates — process pending commissions hourly
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

  // Move PENDING commissions to APPROVED for deals completed > 7 days ago
  const cutoff = new Date(Date.now() - 7 * 24 * 3600000);
  const result = await prisma.commission.updateMany({
    where: { status: "PENDING", createdAt: { lte: cutoff } },
    data: { status: "APPROVED" },
  });

  return NextResponse.json({ success: true, data: { approved: result.count, timestamp: new Date().toISOString() } });
}
