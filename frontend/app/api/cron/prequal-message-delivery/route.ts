import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) return new NextResponse("Unauthorized", { status: 401 });
  // Process queued prequal decision notifications
  const pending = await prisma.preQualification.findMany({ where: { decision: "APPROVED", updatedAt: { gte: new Date(Date.now() - 4 * 3600000) } }, include: { buyer: true }, take: 50 });
  for (const pq of pending) {
    const existing = await prisma.notification.findFirst({ where: { buyerId: pq.buyerId, type: "PREQUAL_APPROVED" } });
    if (!existing) {
      await prisma.notification.create({ data: { buyerId: pq.buyerId, type: "PREQUAL_APPROVED", title: "Pre-qualification approved", body: `Your approved budget is $${(pq.maxOtdAmountCents / 100).toLocaleString()}.`, actionUrl: "/buyer/prequal" } }).catch(() => {});
    }
  }
  return NextResponse.json({ success: true, data: { delivered: pending.length } });
}
