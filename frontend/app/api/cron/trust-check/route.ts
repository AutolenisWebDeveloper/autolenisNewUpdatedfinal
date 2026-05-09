// trust-check — hourly trust infrastructure check
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

  // Check for anti-circumvention flags
  const flaggedMessages = await prisma.message.count({ where: { antiCircumventionFlag: { not: null }, isRedacted: true } });
  const flaggedThreads = await prisma.messageThread.count({ where: { status: "FLAGGED", flaggedAt: { gte: new Date(Date.now() - 24 * 3600000) } } });

  // Refresh platform stats cache by updating latest snapshot
  const latestSnapshot = await prisma.platformStatSnapshot.findFirst({ orderBy: { snapshotDate: "desc" } });

  if (flaggedThreads > 0) {
    await prisma.notification.create({
      data: { title: "Trust Check: Flagged Threads", body: `${flaggedThreads} message thread(s) flagged in last 24 hours`, type: "SYSTEM_ALERT" },
    }).catch(() => {});
  }

  return NextResponse.json({ success: true, data: { flaggedMessages, flaggedThreads, timestamp: new Date().toISOString() } });
}
