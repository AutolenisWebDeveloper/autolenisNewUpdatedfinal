// E-sign executed-artifact / certificate / confirmation reconciliation (§8).
// Runs every 5 minutes. For every COMPLETED envelope still missing its executed
// contract artifact, evidence certificate, or buyer/dealer confirmations, re-drives
// finalizeSignedContract from the frozen signing evidence — idempotent and
// immutable-safe (guarded writes never overwrite an existing artifact). Logic lives
// in the signing service; this route is a thin authorized entry point.
//
// Cutover gate: the executed-artifact schema (migrations 20261014 + 20261015) is
// authored but DELIBERATELY UNAPPLIED in production, blocked pending attorney
// review. Every column this sweep filters and writes on is therefore absent, so
// the sweep is gated behind ESIGN_EXECUTED_ARTIFACT_ENABLED (default OFF — see
// lib/services/esign/esign-schema-gate.ts). While it is off the sweep reports a
// truthful skip: the run is recorded COMPLETED by withCronRun because nothing
// failed and nothing was attempted, and the response says `skipped` with the
// reason rather than implying a clean sweep.
import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { reconcileSignedContracts } from "@/lib/services/esign/buyer-signing.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("esign-artifact-reconcile", async () => {
    const result = await reconcileSignedContracts();
    if (result.skipped) {
      logger.info(
        `[esign-artifact-reconcile] skipped (${result.reason}) — executed-artifact schema is gated off; no envelopes examined`,
      );
    } else {
      logger.info(
        `[esign-artifact-reconcile] finalized ${result.finalized}/${result.scanned} ` +
          `(pending=${result.pending}, stuck=${result.stuck})`,
      );
    }
    return result;
  });
  if (!run.ok) return NextResponse.json({ success: false, error: "esign-artifact-reconcile_failed" }, { status: 500 });

  return NextResponse.json({ success: true, ...run.result });
}
