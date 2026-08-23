// WO-4 — Content publisher cron.
// Publishes due, approved, validated buying-guide articles
// (scheduledAt reached). Mirrors the social-publish-queue cron: Bearer
// CRON_SECRET auth (authorizeCronRequest), maxDuration, MAX_PER_RUN. Schedule: every 5 minutes.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { publishDueScheduled } from "@/lib/services/content/content-publishing.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const maxDuration = 300;

const MAX_PER_RUN = 10;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("content-publisher", () => publishDueScheduled(MAX_PER_RUN));
  if (!run.ok) return NextResponse.json({ success: false, error: "content-publisher_failed" }, { status: 500 });
  logger.info("[content-publisher]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
