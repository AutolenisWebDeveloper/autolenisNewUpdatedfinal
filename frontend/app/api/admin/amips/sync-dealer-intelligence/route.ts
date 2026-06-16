import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { syncDealerIntelligence } from "@/lib/amips/pipelines/dealer-intelligence.pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// POST — populate Dealer Intelligence from the DealerProspect cache and
// recompute same-brand density scores. Admin-only.
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const result = await syncDealerIntelligence();
    await createAuditLog(admin, request, {
      action: "AMIPS_SYNC_DEALER_INTELLIGENCE",
      entityType: "DealerIntelligence",
      entityId: "batch",
      metadata: { ...result },
    });
    return adminSuccess(result);
  } catch (err) {
    logger.error("[amips-p1-dealer] route error:", err);
    return adminError("SYNC_FAILED", (err as Error).message, 500);
  }
}
