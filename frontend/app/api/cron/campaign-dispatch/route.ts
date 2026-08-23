// campaign-dispatch — fans due CRM campaigns out to per-recipient comms sends.
//
// Migrated off the Inngest `campaignFanoutFn` (event autolenis/campaign.execute)
// + `scheduledCampaignCronFn`. Scans campaigns that are due (status='scheduled'
// AND scheduled_at <= now — covering scheduled AND send-immediately campaigns,
// which the create route now stamps scheduled_at=now) and fans each one out.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainDueCampaigns } from "@/lib/services/campaign/campaign-dispatch.service";

// A campaign can resolve a large segment + enqueue many recipients; give headroom.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("campaign-dispatch", () => drainDueCampaigns());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "campaign_dispatch_failed" }, { status: 500 });
  }
  logger.info("[campaign-dispatch]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
