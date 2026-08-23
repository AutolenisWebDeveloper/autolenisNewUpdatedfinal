// sessions — clean expired sessions every 6 hours
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { prisma } from "@/lib/prisma";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("sessions", async () => {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { deleted: count };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "sessions_failed" }, { status: 500 });
  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
