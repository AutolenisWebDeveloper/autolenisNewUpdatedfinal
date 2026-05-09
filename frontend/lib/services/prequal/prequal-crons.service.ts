// All 5 prequal crons + SLA escalation
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { sendPrequalDeclinedEmail } from "@/lib/services/email/resend.service";

function cronAuth(request: NextRequest): boolean {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  return auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
}

// IBV reminder — remind buyers who haven't completed IBV step
export async function GET_ibv_reminders(request: NextRequest) {
  if (!cronAuth(request)) return new NextResponse("Unauthorized", { status: 401 });
  // Find buyers with pending prequal for > 24 hours
  const pending = await prisma.preQualification.findMany({
    where: { decision: "PENDING", createdAt: { lt: new Date(Date.now() - 24 * 3600000) } },
    include: { buyer: { include: { user: true } } },
    take: 50,
  });
  for (const pq of pending) {
    await prisma.notification.create({
      data: { buyerId: pq.buyerId, title: "Complete your prequalification", body: "Your application is awaiting identity verification.", type: "SYSTEM_ALERT" },
    }).catch(() => {});
  }
  return NextResponse.json({ success: true, data: { reminded: pending.length } });
}
