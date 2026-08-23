import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("prequal-message-delivery", async () => {
  // Process queued prequal decision notifications
  const pending = await prisma.preQualification.findMany({ where: { decision: "APPROVED", updatedAt: { gte: new Date(Date.now() - 4 * 3600000) } }, include: { buyer: true }, take: 50 });
  for (const pq of pending) {
    const existing = await prisma.notification.findFirst({ where: { buyerId: pq.buyerId, type: "PREQUAL_APPROVED" } });
    if (!existing) {
      await prisma.notification.create({ data: { buyerId: pq.buyerId, type: "PREQUAL_APPROVED", title: "Pre-qualification approved", body: `Your approved budget is $${(pq.maxOtdAmountCents / 100).toLocaleString()}.`, actionUrl: "/buyer/prequal" } }).catch(() => {});
    }
  }
  return { delivered: pending.length };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "prequal-message-delivery_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: run.result });
}
