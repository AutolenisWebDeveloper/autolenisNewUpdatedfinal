import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { computeMarketScoreBatch } from "@/lib/amips/pipelines/market-score-batch.pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST — pre-compute the AutoLenis Market Score for every qualifying
// make/model x metro combination into the amips_market_scores cache. Admin-only.
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const result = await computeMarketScoreBatch();
    await createAuditLog(admin, request, {
      action: "AMIPS_COMPUTE_MARKET_SCORES",
      entityType: "AmipsMarketScore",
      entityId: "batch",
      metadata: { ...result },
    });
    return adminSuccess(result);
  } catch (err) {
    logger.error("[amips-p1-scores] route error:", err);
    return adminError("COMPUTE_FAILED", (err as Error).message, 500);
  }
}
