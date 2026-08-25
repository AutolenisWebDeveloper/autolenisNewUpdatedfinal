// B′ (Block B / Apollo) — scheduled/manual backfill of dealer contacts.
//
// Two phases per run (see the service): Phase 0 resolves canonical rooftops for the
// Dealer + Prospect population and reconciles existing contacts (FREE); Phase 1
// reveals a send-safe contact for DealerRooftops that still have none, via the gated
// Apollo path (consumer="backfill" → leftover budget only, above the live reserve).
// Idempotent + fail-closed: OFF unless Apollo is enabled + the probe cap is set, so
// the whole job (resolution included) is a no-op — no query, no spend — until
// explicitly turned on. Registered in vercel.json as a daily off-peak cron so that,
// once the owner enables Apollo, it drains the population automatically; while Apollo
// stays off the scheduled run returns immediately. Lives under /api/cron so it is
// CSRF-exempt and cron-secret enforced at the edge (proxy.ts validateCronRequest);
// the handler re-checks the secret defensively.
// Optional ?limit=, ?resolveLimit=, ?makes=, ?states= (CSV).
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { runDealerContactBackfill, MAX_CANDIDATE_SCAN } from "@/lib/services/dealer-recruitment/dealer-contact-backfill.service";
import { withCronRun } from "@/lib/services/monitoring/cron-monitor.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const sp = request.nextUrl.searchParams;
  // Clamp an explicit numeric override to the scan bound so a single invocation's
  // work is bounded (spend is already ledger-capped; this bounds churn/round-trips).
  const clamp = (raw: string | null): number | undefined => {
    const parsed = raw ? Number(raw) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), MAX_CANDIDATE_SCAN) : undefined;
  };
  const limit = clamp(sp.get("limit"));
  const resolveLimit = clamp(sp.get("resolveLimit"));

  const csv = (v: string | null): string[] | undefined => {
    if (!v) return undefined;
    const items = v.split(",").map((s) => s.trim()).filter(Boolean);
    return items.length ? items : undefined;
  };

  // Wrap in withCronRun so the scheduled fire is recorded for dead-cron monitoring
  // (mirrors apollo-ledger-rollover). A no-op run while Apollo is off still records
  // a healthy run, so the cron never reads as OVERDUE just for being gated off.
  const run = await withCronRun("dealer-contact-backfill", () =>
    runDealerContactBackfill({
      limit,
      resolveLimit,
      priorityMakes: csv(sp.get("makes")),
      priorityStates: csv(sp.get("states")),
    }),
  );
  if (!run.ok) {
    return NextResponse.json({ success: false, error: String(run.error) }, { status: 500 });
  }
  return NextResponse.json({ success: true, data: run.result, timestamp: new Date().toISOString() });
}
