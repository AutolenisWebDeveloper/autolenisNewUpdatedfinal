// amips-search-sync — weekly Google Search Console pull for AMIPS pages.
//
// Runs Mondays at 05:00 UTC (see vercel.json). Syncs the previous complete ISO
// week (GSC data lags 2–3 days, so we never query the in-progress week) into
// search_intelligence, then re-prioritizes the content queue from real search
// demand once Search Intelligence has matured.
import { logger } from "@/lib/logger";
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import {
  syncSearchIntelligence,
  mondayOf,
} from "@/lib/amips/pipelines/search-intelligence.pipeline";
import { reprioritizeContentQueue } from "@/lib/amips/seed/content-queue.seed";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  // Previous complete week: Monday of this week, minus 7 days.
  const thisMonday = mondayOf(new Date());
  const weekOf = new Date(thisMonday);
  weekOf.setUTCDate(weekOf.getUTCDate() - 7);

  const siteUrl = process.env.GSC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!siteUrl) {
    return NextResponse.json(
      { success: false, error: "No GSC_SITE_URL / NEXT_PUBLIC_APP_URL configured" },
      { status: 200 },
    );
  }

  const run = await withCronRun("amips-search-sync", async () => {
  const search = await syncSearchIntelligence(siteUrl, weekOf);
  const reprioritized = await reprioritizeContentQueue();

  logger.info(
    `[amips-cron] search-sync — synced ${search.synced}, reprioritized ${reprioritized.reprioritized} (${reprioritized.mode})`,
  );

  return {
    weekOf: weekOf.toISOString().slice(0, 10),
    synced: search.synced,
    reprioritized,
  };
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "amips-search-sync_failed" }, { status: 500 });

  return NextResponse.json({
    success: true,
    data: run.result,
  });
}
