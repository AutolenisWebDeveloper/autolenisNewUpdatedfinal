// contract-shield — batch contract scanning
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { scanContractVersion } from "@/lib/services/dealer/dealer-contract.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret =
    !!process.env.CRON_SECRET &&
    auth?.length === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`.length &&
    auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("contract-shield", async () => {
  // Find contract versions awaiting a scan (or reset to UPLOADED after a
  // transient extraction failure on a prior pass).
  const pendingVersions = await prisma.contractVersion.findMany({
    where: { status: "UPLOADED" },
    select: { id: true },
    take: 20,
  });

  // Scan each against the REAL extracted PDF text. scanContractVersion converges
  // the status (PASS→APPROVED, WARNING/FAIL→REJECTED, error→retryable UPLOADED)
  // and fails closed — it never auto-approves a document it could not read.
  for (const cv of pendingVersions) {
    await scanContractVersion(cv.id).catch(() => {});
  }

  return { scanned: pendingVersions.length };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "contract-shield_failed" }, { status: 500 });

  return NextResponse.json({ success: true, data: { ...run.result, timestamp: new Date().toISOString() } });
}
