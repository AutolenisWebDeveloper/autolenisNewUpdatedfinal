import { NextRequest } from "next/server";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { syncMarketIntelligence } from "@/lib/amips/pipelines/market-intelligence.pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST — populate Market Intelligence for the top 25 metros (Census population
// + dealer-derived scores). Admin-only.
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const result = await syncMarketIntelligence();
    await createAuditLog(admin, request, {
      action: "AMIPS_SYNC_MARKET_INTELLIGENCE",
      entityType: "MarketIntelligence",
      entityId: "batch",
      metadata: { ...result },
    });
    return adminSuccess(result);
  } catch (err) {
    console.error("[amips-p1-market] route error:", err);
    return adminError("SYNC_FAILED", (err as Error).message, 500);
  }
}
