// Content Autopilot — scheduled generation seeder cron.
//
// The missing trigger for the buying-guide Content Engine. Everything downstream
// already ran autonomously (content-generation-drain claims QUEUED items every
// 2 minutes, generates, and lets the compliance/quality/validation gates decide
// PUBLISHED vs REVIEW_NEEDED) — but nothing ever filled that queue outside an
// admin pressing "generate". This cron fills it once a day from CONTENT_KEYWORDS.
//
// Mirrors the content-publisher cron: Bearer CRON_SECRET auth
// (authorizeCronRequest), withCronRun, maxDuration, MAX_PER_RUN, structured JSON.
// Schedule: once per day at 08:00 UTC (CONTENT_SEED_SCHEDULE, pinned against
// vercel.json by a test).
//
// SHIPS DISABLED. The seeder itself is gated on CONTENT_AUTOPILOT_ENABLED and
// returns { enabled: false, enqueued: 0 } until the owner sets it to exactly
// "true" — so deploying this route does not start publishing to the public site,
// and the run still records a truthful skip in the cron-monitor.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import {
  CONTENT_SEED_MAX_PER_RUN,
  seedScheduledGeneration,
} from "@/lib/services/content/content-generation.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

// Seeding is two indexed reads plus one insert — nowhere near this, but the
// keyword sweep grows with CONTENT_KEYWORDS, so keep the cron headroom.
export const maxDuration = 300;

// Slugs enqueued per run. EACH ITEM IS ONE GROQ GENERATION, so raising this
// raises spend linearly (25/day = 25 generations/day). Owned by the service so
// the cap and the schedule live together — see CONTENT_SEED_MAX_PER_RUN.
const MAX_PER_RUN = CONTENT_SEED_MAX_PER_RUN;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("content-generation-seed", () =>
    seedScheduledGeneration(MAX_PER_RUN),
  );
  if (!run.ok) {
    return NextResponse.json(
      { success: false, error: "content_generation_seed_failed" },
      { status: 500 },
    );
  }
  logger.info("[content-generation-seed]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
