import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) return new NextResponse("Unauthorized", { status: 401 });
  // Escalate OFAC flags that haven't been reviewed in 24 hours
  const unreviewed = await prisma.preQualification.count({ where: { checkOfacAlert: true, decision: "OFAC_ESCALATED" } });
  if (unreviewed > 0) {
    await prisma.notification.create({ data: { title: "OFAC Escalation SLA", body: `${unreviewed} OFAC escalation(s) require immediate review`, type: "SYSTEM_ALERT" } }).catch(() => {});
  }
  return NextResponse.json({ success: true, data: { escalated: unreviewed } });
}
