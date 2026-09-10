// Y5 (Block A) — manual/scheduled backfill of Dealer + DealerProspect coordinates.
//
// Populates latitude/longitude from each row's ZIP via the geocoding adapter
// (static -> cache -> Google). Idempotent: only rows with null coords + a ZIP are
// selected, so re-running resolves the remainder without re-geocoding done rows.
// Lives under /api/cron so it is CSRF-exempt and cron-secret enforced at the edge
// (proxy.ts validateCronRequest); the handler re-checks the secret defensively.
// Optional ?limit= caps rows per pool per run.
//
// PHASE 4 adds a third pool: `shortlist_items.distance_miles`. It belongs HERE rather than in
// a cron of its own because it is the same job one step downstream — a shortlist distance can
// only be computed once both ends are geocoded, so running it immediately after the coordinate
// backfill is the earliest point at which it can succeed. The column was declared by the
// Phase 1 wave and never written: all 15 production rows carry NULL, so every saved candidate
// reads as "distance unknown" and fails closed. Same idempotency rule as the pools above —
// only rows with a NULL distance are selected, and a row whose buyer or listing cannot be
// placed is left NULL rather than given a guess.
import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/security/cron-auth";
import { backfillCoordinates } from "@/lib/services/integrations/geocoding.service";
import { backfillShortlistDistances } from "@/lib/services/shortlist/shortlist.service";

export async function GET(request: NextRequest) {
  const cronAuth = authorizeCronRequest(request);
  if (cronAuth) return cronAuth;

  const limitParam = request.nextUrl.searchParams.get("limit");
  const parsed = limitParam ? Number(limitParam) : NaN;
  const limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;

  try {
    const result = await backfillCoordinates(undefined, limit ? { limit } : undefined);
    // Coordinates first, distances second: a buyer geocoded by the call above is placeable by
    // the call below on the SAME run rather than the next one.
    const shortlistDistances = await backfillShortlistDistances(limit ?? 500);
    return NextResponse.json({
      success: true,
      data: { ...result, shortlistDistances },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
