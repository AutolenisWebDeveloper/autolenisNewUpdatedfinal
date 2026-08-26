// esign-envelope-reconcile — durability backstop for DocuSign signature
// completion. If the `envelope-completed` webhook is never delivered, a deal
// would otherwise sit at SIGNING_PENDING forever; this cron polls DocuSign for
// the authoritative envelope status and drives the same idempotent handlers the
// webhook uses (completion / decline / void). See
// lib/services/esign/esign-reconcile.service.ts.
//
// DORMANT without real DocuSign: getEnvelopeStatus returns null in mock mode, so
// this cron no-ops until real DocuSign is configured. Runs every 15 min — a
// dropped signing webhook is recovered within one window.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { reconcileEsignEnvelopes } from "@/lib/services/esign/esign-reconcile.service";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("esign-envelope-reconcile", () => reconcileEsignEnvelopes());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "esign_envelope_reconcile_failed" }, { status: 500 });
  }
  logger.info("[esign-envelope-reconcile]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
