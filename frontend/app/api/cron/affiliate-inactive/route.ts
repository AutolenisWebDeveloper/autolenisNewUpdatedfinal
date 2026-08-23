// /api/cron/affiliate-inactive — weekly (Mon 9AM) inactive-affiliate sweep.
// Finds ACTIVE affiliates with no referral activity in the last 30 days that
// haven't been nudged recently, and dispatches the affiliate-inactive job.
// Cron schedule configured in vercel.json. Manually runnable via authenticated GET.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { dispatch } from "@/lib/qstash/dispatch";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Up to 500 affiliates × a couple of activity lookups each.
export const maxDuration = 180;

const INACTIVITY_WINDOW_MS = 30 * 24 * 3600 * 1000;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("affiliate-inactive", async () => {
  const cutoff = new Date(Date.now() - INACTIVITY_WINDOW_MS);

  const affiliates = await prisma.affiliate.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      lastInactiveNudgeAt: true,
      user: { select: { email: true } },
      profile: { select: { firstName: true } },
    },
    take: 500,
  });

  let dispatched = 0;
  let skippedActive = 0;
  let skippedAlreadyNudged = 0;
  let skippedNoEmail = 0;

  for (const aff of affiliates) {
    // Already nudged within the inactivity window — don't re-dispatch weekly.
    if (aff.lastInactiveNudgeAt && aff.lastInactiveNudgeAt >= cutoff) {
      skippedAlreadyNudged += 1;
      continue;
    }

    // Referral activity = a buyer they referred or a commission earned in the
    // window. Either signal means the affiliate is active; skip them.
    const [recentBuyer, recentCommission] = await Promise.all([
      prisma.buyer.findFirst({
        where: { affiliateId: aff.id, createdAt: { gte: cutoff } },
        select: { id: true },
      }),
      prisma.commission.findFirst({
        where: { affiliateId: aff.id, createdAt: { gte: cutoff } },
        select: { id: true },
      }),
    ]);
    if (recentBuyer || recentCommission) {
      skippedActive += 1;
      continue;
    }

    const email = aff.user?.email;
    if (!email) {
      skippedNoEmail += 1;
      continue;
    }

    await dispatch({
      path: "/api/jobs/affiliate-inactive",
      body: {
        affiliateId: aff.id,
        firstName: aff.profile?.firstName ?? "there",
        email,
      },
    });

    // Stamp the dispatch so the next weekly run won't re-nudge this affiliate.
    await prisma.affiliate.update({
      where: { id: aff.id },
      data: { lastInactiveNudgeAt: new Date() },
    });
    dispatched += 1;
  }

  logger.info("[cron/affiliate-inactive]", {
    scanned: affiliates.length,
    dispatched,
    skippedActive,
    skippedAlreadyNudged,
    skippedNoEmail,
  });

  return {
    scanned: affiliates.length,
    dispatched,
    skippedActive,
    skippedAlreadyNudged,
    skippedNoEmail,
  };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "affiliate-inactive_failed" }, { status: 500 });

  return NextResponse.json({
    success: true,
    data: {
      ...run.result,
      timestamp: new Date().toISOString(),
    },
  });
}
