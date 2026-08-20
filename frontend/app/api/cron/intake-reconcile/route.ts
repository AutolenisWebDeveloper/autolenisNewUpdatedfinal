// S2 — stuck-intake reconciler. Mirrors the auction-close F-001 reconciler.
//
// Every few minutes, find BuyerOpportunity rows whose durable intake never
// completed (intakeProcessedAt IS NULL) beyond a staleness threshold — whose
// linked VehicleRequest is still sourcing, OR which have no VehicleRequest at
// all — and re-emit autolenis/intake.process for each. Safe to re-drive:
// intakeProcessFn is idempotent (guard + per-stage skips) and the S1 discovery
// guard prevents duplicate prospects. Bounded per run (take:100, oldest-first);
// any remainder is picked up next tick.
//
// Uses intakeProcessedAt as the ONLY "done" marker — never inferred from
// marketEnrichedAt or prospect presence — so a legitimate zero-dealer
// coverage-gap intake (which still stamps intakeProcessedAt) is NOT re-driven.

import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { inngest } from "@/lib/inngest/client";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// A just-submitted intake's worker may still be running: enrichment + discovery +
// phone-script drafting (12s per discovered prospect, which can be dozens) + Inngest
// retry backoff. Only reconcile rows older than this generous threshold so we don't
// waste re-emits on in-flight intakes. (Correctness never depends on this — the
// idempotency guard blocks a re-emit of a still-running intake regardless.)
const STUCK_INTAKE_THRESHOLD_MINUTES = 30;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const run = await withCronRun("intake-reconcile", async () => {
  const now = new Date();
  const threshold = new Date(now.getTime() - STUCK_INTAKE_THRESHOLD_MINUTES * 60 * 1000);

  const stuck = await prisma.buyerOpportunity.findMany({
    where: {
      intakeProcessedAt: null,
      createdAt: { lt: threshold },
      // Cover BOTH stuck cases: an opportunity whose linked VehicleRequest is
      // still sourcing, AND an opportunity with no VehicleRequest at all (no
      // buyer resolved / the VR insert threw) — the pipeline still does real
      // work for those, so they must self-heal too. A VR that has advanced past
      // ACTIVE_SOURCING is intentionally excluded (sourcing already happened).
      OR: [
        { vehicleRequests: { some: { status: { in: ["SUBMITTED", "INTAKE", "ACTIVE_SOURCING"] } } } },
        { vehicleRequests: { none: {} } },
      ],
    },
    select: { id: true },
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  let reEmitted = 0;
  for (const opp of stuck) {
    try {
      await inngest.send({
        name: "autolenis/intake.process",
        data: { buyerOpportunityId: opp.id },
      });
      reEmitted += 1;
    } catch (err) {
      logger.error(`[intake-reconcile] re-emit failed for ${opp.id}:`, err);
    }
  }

  if (reEmitted > 0) {
    logger.info(`[intake-reconcile] re-drove ${reEmitted}/${stuck.length} stuck intake(s)`);
  }

    return { found: stuck.length, reEmitted, timestamp: now.toISOString() };
  });

  if (!run.ok) {
    return NextResponse.json({ success: false, error: "reconcile_failed" }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result });
}
