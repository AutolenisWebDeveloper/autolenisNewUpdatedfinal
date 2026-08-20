// trust-check — hourly trust infrastructure check
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

  const run = await withCronRun("trust-check", async () => {
  // Check for anti-circumvention flags
  const flaggedMessages = await prisma.message.count({ where: { antiCircumventionFlag: { not: null }, isRedacted: true } });
  const flaggedThreads = await prisma.messageThread.count({ where: { status: "FLAGGED", flaggedAt: { gte: new Date(Date.now() - 24 * 3600000) } } });

  if (flaggedThreads > 0) {
    await prisma.notification.create({
      data: { title: "Trust Check: Flagged Threads", body: `${flaggedThreads} message thread(s) flagged in last 24 hours`, type: "SYSTEM_ALERT" },
    }).catch(() => {});
  }

  return { flaggedMessages, flaggedThreads };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "trust-check_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
