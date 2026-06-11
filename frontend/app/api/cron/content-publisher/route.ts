// WO-4 — Content publisher cron.
// Publishes due, approved, validated buying-guide articles
// (scheduledAt reached). Mirrors the social-publish-queue cron: CRON_SECRET /
// x-vercel-cron auth, maxDuration, MAX_PER_RUN. Schedule: every 5 minutes.

import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { publishDueScheduled } from "@/lib/services/content/content-publishing.service";

export const maxDuration = 300;

const MAX_PER_RUN = 10;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const summary = await publishDueScheduled(MAX_PER_RUN);
  console.log("[content-publisher]", JSON.stringify(summary));
  return NextResponse.json({ success: true, data: summary });
}
