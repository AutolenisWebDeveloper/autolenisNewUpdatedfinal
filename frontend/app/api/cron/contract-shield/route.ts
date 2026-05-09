// contract-shield — batch contract scanning
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { scanContract } from "@/lib/services/contract-shield/contract-shield.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Find deals pending contract review with a contract version uploaded
  const pendingVersions = await prisma.contractVersion.findMany({
    where: { status: "UPLOADED" },
    include: { deal: { include: { offer: { select: { dealerId: true } } } } },
    take: 20,
  });

  let scanned = 0;
  for (const cv of pendingVersions) {
    try {
      await prisma.contractVersion.update({ where: { id: cv.id }, data: { status: "SCANNING", scanRunAt: new Date() } });
      // Contract text would be fetched from documentUrl in production
      await scanContract(cv.dealId, `Contract version ${cv.version}`, cv.deal.offer.dealerId);
      await prisma.contractVersion.update({ where: { id: cv.id }, data: { status: "APPROVED" } });
      scanned++;
    } catch (err) {
      await prisma.contractVersion.update({ where: { id: cv.id }, data: { status: "REJECTED", rejectionReason: String(err) } }).catch(() => {});
    }
  }

  return NextResponse.json({ success: true, data: { scanned, timestamp: new Date().toISOString() } });
}
