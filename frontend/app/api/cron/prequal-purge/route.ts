import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) return new NextResponse("Unauthorized", { status: 401 });
  // Purge expired pre-qualifications older than 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 3600000);
  const { count } = await prisma.preQualification.deleteMany({ where: { expiresAt: { lt: cutoff }, decision: { in: ["DECLINED", "MANUAL_REVIEW"] } } });
  return NextResponse.json({ success: true, data: { purged: count } });
}
