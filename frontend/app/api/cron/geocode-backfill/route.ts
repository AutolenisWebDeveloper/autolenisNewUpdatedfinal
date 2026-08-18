// Y5 (Block A) — manual/scheduled backfill of Dealer + DealerProspect coordinates.
//
// Populates latitude/longitude from each row's ZIP via the geocoding adapter
// (static -> cache -> Google). Idempotent: only rows with null coords + a ZIP are
// selected, so re-running resolves the remainder without re-geocoding done rows.
// Lives under /api/cron so it is CSRF-exempt and cron-secret enforced at the edge
// (proxy.ts validateCronRequest); the handler re-checks the secret defensively.
// Optional ?limit= caps rows per pool per run.
import { NextRequest, NextResponse } from "next/server";
import { CRON_AUTH_HEADER, CRON_AUTH_PREFIX } from "@/lib/constants";
import { backfillCoordinates } from "@/lib/services/integrations/geocoding.service";

export async function GET(request: NextRequest) {
  const auth = request.headers.get(CRON_AUTH_HEADER);
  const isVercelCron = request.headers.get("x-vercel-cron") === "1";
  const isValidSecret = auth === `${CRON_AUTH_PREFIX}${process.env.CRON_SECRET}`;
  if (!isVercelCron && !isValidSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsed = limitParam ? Number(limitParam) : NaN;
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;

  try {
    const result = await backfillCoordinates(undefined, limit ? { limit } : undefined);
    return NextResponse.json({ success: true, data: result, timestamp: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
