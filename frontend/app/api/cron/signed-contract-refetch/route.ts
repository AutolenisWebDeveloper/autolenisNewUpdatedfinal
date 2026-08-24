// signed-contract-refetch — durability backstop that re-fetches the executed
// DocuSign PDF for any envelope left COMPLETED with documentKey=null (the inline
// webhook retrieval blipped). See lib/services/esign/signed-contract-refetch.service.ts.
//
// DORMANT without real DocuSign: retrieveAndStoreSignedContract returns null in
// mock/unconfigured mode, so this cron no-ops until real DocuSign is configured.
// Runs every 30 min — a missing signed PDF is not time-critical, and the buyer
// download route reports "not yet available" until this stores it.

import { logger } from "@/lib/logger";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { NextRequest, NextResponse } from "next/server";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";
import { refetchMissingSignedContracts } from "@/lib/services/esign/signed-contract-refetch.service";

export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("signed-contract-refetch", () => refetchMissingSignedContracts());
  if (!run.ok) {
    return NextResponse.json({ success: false, error: "signed_contract_refetch_failed" }, { status: 500 });
  }
  logger.info("[signed-contract-refetch]", JSON.stringify(run.result));
  return NextResponse.json({ success: true, data: run.result });
}
