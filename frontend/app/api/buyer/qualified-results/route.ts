// GET /api/buyer/qualified-results — the live, prequal-gated buyer search (§22a; Phase 4 QUAL).
//
// Thin by design. Every decision — approval, location, the 10% headroom, the policy radius, the
// per-card action, whether the market is knowable — belongs to
// `lib/services/inventory/qualified-results.service.ts` and is tested there. This route parses,
// authenticates, and hands the service's verdict back unaltered.
//
// It is DELIBERATELY not `/api/buyer/search`. That route reads the swept `inventory_items`
// table and keeps every filter a buyer has today (features, drivetrain, transmission, fuel);
// this one spends a provider call from the monthly ledger and can only ask what the provider
// supports. Two supply sources, one policy module, no duplicated gate.

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { getQualifiedResults, type QualifiedCriteria } from "@/lib/services/inventory/qualified-results.service";

export const dynamic = "force-dynamic";

const CONDITIONS = new Set(["new", "used", "certified"]);

function intParam(v: string | null, min: number, max: number): number | undefined {
  if (!v) return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
}

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const q = new URL(request.url).searchParams;

  const criteria: QualifiedCriteria = {
    make: q.get("make")?.trim() || undefined,
    model: q.get("model")?.trim() || undefined,
    yearMin: intParam(q.get("yearMin"), 1990, 2100),
    yearMax: intParam(q.get("yearMax"), 1990, 2100),
    milesMax: intParam(q.get("mileageMax"), 0, 1_000_000),
    condition: CONDITIONS.has((q.get("condition") ?? "").trim().toLowerCase())
      ? (q.get("condition") as string).trim().toLowerCase()
      : undefined,
    priceMinCents: intParam(q.get("priceMinCents"), 0, 100_000_000),
  };

  // NOTE what is absent: no `radiusMiles` and no `priceMax`. The radius is AutoLenis policy and
  // the ceiling is the buyer's approval plus the ruled headroom; neither is the client's to set,
  // and accepting either would let a query string move a policy boundary.
  const zip = q.get("zip")?.trim();

  const view = await getQualifiedResults({
    buyerId: buyer.id,
    criteria,
    zip: zip && /^\d{5}$/.test(zip) ? zip : undefined,
  });

  return successResponse(view);
}
