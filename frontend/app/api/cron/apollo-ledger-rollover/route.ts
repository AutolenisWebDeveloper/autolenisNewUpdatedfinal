// Apollo credit-ledger rollover — ensures the CURRENT billing cycle's
// ApolloCreditLedger row exists (idempotent), so the paid reveal tier never fails
// closed for a whole calendar month just because nobody manually seeded the new
// row. The cap is set on creation only (getOrCreateCycle never changes an existing
// row's cap), so re-running is a no-op. Runs daily (self-healing against a missed
// run at month rollover) — cheap and idempotent. Removes the recurring manual seed.
//
// This does NOT enable the tier and never spends: it only guarantees the cap row.
// Lives under /api/cron (CSRF-exempt, cron-secret enforced at the edge by
// proxy.ts validateCronRequest); the handler re-checks the secret defensively.
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { ensureCurrentCycleLedger } from "@/lib/services/dealer-recruitment/apollo-credit-ledger.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const run = await withCronRun("apollo-ledger-rollover", () => ensureCurrentCycleLedger(new Date()));
  if (!run.ok) {
    return NextResponse.json({ success: false, error: String(run.error) }, { status: 500 });
  }
  const row = run.result;
  return NextResponse.json({
    success: true,
    cycleKey: row.cycleKey,
    capCredits: row.capCredits,
    spentCredits: row.spentCredits,
    timestamp: new Date().toISOString(),
  });
}
