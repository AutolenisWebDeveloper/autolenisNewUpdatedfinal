// B′ (Block B / Apollo) — manual/scheduled backfill of rooftop contacts.
//
// Reveals a send-safe contact for DealerRooftops that have none, via the gated
// Apollo path (consumer="backfill" → leftover budget only, above the live reserve).
// Idempotent + fail-closed: OFF unless Apollo is enabled + the probe cap is set, so
// this is a no-op (no query, no spend) until explicitly turned on. Deliberately NOT
// registered in vercel.json crons — invocation stays opt-in until reviewed/enabled,
// matching geocode-backfill. Lives under /api/cron so it is CSRF-exempt and
// cron-secret enforced at the edge (proxy.ts validateCronRequest); the handler
// re-checks the secret defensively. Optional ?limit=, ?makes=, ?states= (CSV).
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { runDealerContactBackfill, MAX_CANDIDATE_SCAN } from "@/lib/services/dealer-recruitment/dealer-contact-backfill.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const limitParam = sp.get("limit");
  const parsed = limitParam ? Number(limitParam) : NaN;
  // Clamp an explicit ?limit= to the scan bound so a single invocation's work is
  // bounded (spend is already ledger-capped; this bounds churn/round-trips).
  const limit =
    Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), MAX_CANDIDATE_SCAN) : undefined;

  const csv = (v: string | null): string[] | undefined => {
    if (!v) return undefined;
    const items = v.split(",").map((s) => s.trim()).filter(Boolean);
    return items.length ? items : undefined;
  };

  try {
    const result = await runDealerContactBackfill({
      limit,
      priorityMakes: csv(sp.get("makes")),
      priorityStates: csv(sp.get("states")),
    });
    return NextResponse.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
