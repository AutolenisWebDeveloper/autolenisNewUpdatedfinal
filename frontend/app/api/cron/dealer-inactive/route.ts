// /api/cron/dealer-inactive — weekly inactive-dealer sweep (mirrors the buyer
// inactivity scanner and the affiliate-inactive cron). Finds ACTIVE dealers with
// no offer activity in the last 30 days and pushes each through the CRM domain-
// event spine (emitDomainEvent → contact upsert + timeline 'domain_event' +
// Make forward). The Make forward no-ops until MAKE_WEBHOOK_URL is set, so this
// is safe to ship dark. The weekly schedule gives a once-per-week nudge cadence;
// the spine's idempotency key (dealer_inactive:<dealerId>) collapses Make-side
// retries within a run. Cron schedule configured in vercel.json. Manually
// runnable via authenticated GET.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { emitDomainEvent } from "@/lib/events/emit";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const dynamic = "force-dynamic";
// Up to 500 dealers × one activity lookup each.
export const maxDuration = 180;

const INACTIVITY_WINDOW_MS = 30 * 24 * 3600 * 1000;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("dealer-inactive", async () => {
  const cutoff = new Date(Date.now() - INACTIVITY_WINDOW_MS);

  const dealers = await prisma.dealer.findMany({
    where: { status: "ACTIVE" },
    select: {
      id: true,
      dealershipName: true,
      user: { select: { email: true } },
    },
    take: 500,
  });

  let emitted = 0;
  let skippedActive = 0;
  let skippedNoEmail = 0;

  for (const dealer of dealers) {
    // Activity signal = an offer submitted within the window. Present → active.
    const recentOffer = await prisma.offer.findFirst({
      where: { dealerId: dealer.id, createdAt: { gte: cutoff } },
      select: { id: true },
    });
    if (recentOffer) {
      skippedActive += 1;
      continue;
    }

    const email = dealer.user?.email;
    if (!email) {
      skippedNoEmail += 1;
      continue;
    }

    // emitDomainEvent never throws to the caller; isolate per-dealer anyway so
    // one failure can't abort the sweep.
    try {
      await emitDomainEvent("dealer_inactive", {
        domainEntityId: dealer.id,
        contact: {
          email,
          firstName: dealer.dealershipName ?? undefined,
          source: "dealer_signup",
        },
        data: { dealer_id: dealer.id, dealership_name: dealer.dealershipName, inactive_since: cutoff.toISOString() },
      });
      emitted += 1;
    } catch (err) {
      logger.error("[cron/dealer-inactive] emit failed for", dealer.id, err);
    }
  }

  logger.info("[cron/dealer-inactive]", {
    scanned: dealers.length,
    emitted,
    skippedActive,
    skippedNoEmail,
  });

  return { scanned: dealers.length, emitted, skippedActive, skippedNoEmail };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "dealer-inactive_failed" }, { status: 500 });

  return NextResponse.json({
    success: true,
    data: { ...run.result, timestamp: new Date().toISOString() },
  });
}
