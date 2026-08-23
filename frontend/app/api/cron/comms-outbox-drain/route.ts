// comms-outbox-drain — delivers queued transactional/marketing email + SMS.
//
// The internal comms-dispatch queue's drain: claims due comms_outbox rows and
// sends them via Resend/Twilio, reproducing every consent/DNC/suppression/TCPA
// gate the retired Inngest emailSendFn/smsSendFn workers applied. Runs every
// minute for timely delivery. DORMANT until producers are cut over to
// enqueueEmail/enqueueSms (until then the queue is empty and this is a no-op).

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainCommsOutbox } from "@/lib/services/comms/comms-outbox.service";

// A batch can make up to 100 provider calls; give it headroom.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("comms-outbox-drain", () => drainCommsOutbox());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "comms_outbox_drain_failed" }, { status: 500 });
  }
  logger.info("[comms-outbox-drain]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
