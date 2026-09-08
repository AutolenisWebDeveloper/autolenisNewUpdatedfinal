// comms-outbox-drain — delivers queued transactional/marketing email + SMS.
//
<<<<<<< HEAD
// The drain for BOTH rails that share `comms_outbox`:
//
//   • the §27 TRANSACTIONAL rail (rows carrying a `template_key`) — every
//     transaction communication, claimed with FOR UPDATE SKIP LOCKED, state-
//     rechecked at send time, and escalated to Operations on terminal failure;
//   • the CRM/campaign rail (rows with no `template_key`) — the retirement
//     substrate for the Inngest emailSendFn/smsSendFn workers.
//
// One cron, one schedule, one minute (`vercel.json`), because §8.2 Phase 2 says
// the existing drain is reused rather than a second one added. The rails are
// partitioned by `template_key` so their two claim mechanisms never race.
//
// FAILURE IS REPORTED AS FAILURE. Each rail is drained independently and a failure
// in one does not hide the other: the response carries both results and the route
// answers 500 if EITHER rail failed. A drain that swallowed one rail's error would
// report a healthy cron while transaction communications silently stopped — which
// is the §27 failure mode this whole rail exists to prevent.
=======
// The internal comms-dispatch queue's drain: claims due comms_outbox rows and
// sends them via Resend/Twilio, reproducing every consent/DNC/suppression/TCPA
// gate the retired Inngest emailSendFn/smsSendFn workers applied. Runs every
// minute for timely delivery. DORMANT until producers are cut over to
// enqueueEmail/enqueueSms (until then the queue is empty and this is a no-op).
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { drainCommsOutbox } from "@/lib/services/comms/comms-outbox.service";
<<<<<<< HEAD
import { drainTransactionalOutbox } from "@/lib/services/comms/transactional-dispatcher.service";

// A batch can make up to 100 provider calls per rail; give it headroom.
=======

// A batch can make up to 100 provider calls; give it headroom.
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

<<<<<<< HEAD
  // The transactional rail first: a buyer waiting on a verification link matters
  // more than a campaign send, and the batch caps mean the order is visible under
  // load rather than theoretical.
  // NAMED PER RAIL. Both ran under "comms-outbox-drain", so each tick wrote two
  // cron_run rows with the same name and a dashboard reading "last successful run"
  // showed green while the transactional rail failed every tick.
  const transactional = await withCronRun("comms-outbox-drain:transactional", () => drainTransactionalOutbox());
  const crm = await withCronRun("comms-outbox-drain:crm", () => drainCommsOutbox());

  const failures: string[] = [];
  if (!transactional.ok) failures.push("transactional");
  if (!crm.ok) failures.push("crm");

  const body = {
    transactional: transactional.ok ? transactional.result : { error: "drain_failed" },
    crm: crm.ok ? crm.result : { error: "drain_failed" },
  };

  if (failures.length > 0) {
    logger.error("[comms-outbox-drain] rail failure", { failed: failures });
    return NextResponse.json(
      { success: false, error: "comms_outbox_drain_failed", failedRails: failures, data: body },
      { status: 500 }
    );
  }

  logger.info("[comms-outbox-drain]", JSON.stringify(body));
  return NextResponse.json({ success: true, data: body });
=======
  const run = await withCronRun("comms-outbox-drain", () => drainCommsOutbox());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "comms_outbox_drain_failed" }, { status: 500 });
  }
  logger.info("[comms-outbox-drain]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
>>>>>>> 92c9fdf4 (Phase 1 (§13-D2): record that the cancel path does not exist, and carry the admin cancel action into Phase 2)
}
