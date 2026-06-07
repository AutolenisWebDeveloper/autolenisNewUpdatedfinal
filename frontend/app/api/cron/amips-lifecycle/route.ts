// amips-lifecycle — weekly AMIPS page lifecycle review.
//
// Runs Tuesdays at 04:00 UTC (see vercel.json), the day after the Search
// Console sync, so transitions act on fresh impression/click data. Applies the
// ACTIVE → REFRESH_REQUIRED / UNDER_REVIEW and UNDER_REVIEW → RETIRED rules.
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { runLifecycleReview } from "@/lib/amips/lifecycle-manager";

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

  const result = await runLifecycleReview();
  console.log(
    `[amips-cron] lifecycle — refresh ${result.flaggedForRefresh}, review ${result.flaggedForReview}, retired ${result.retired}`,
  );
  return NextResponse.json({ success: true, data: result });
}
