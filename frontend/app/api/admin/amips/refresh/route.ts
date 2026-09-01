import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { runAmipsRefresh } from "@/lib/amips/refresh.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST — the manual backfill for the amips-refresh cron (every background job
// has one). Refreshes the AMIPS source data and re-opens the REFRESH_REQUIRED
// pages the refresh rescued, so ops can drain the demoted backlog without
// waiting for 03:00. Admin-only, and audited like the other AMIPS triggers.
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const result = await runAmipsRefresh();
    await createAuditLog(admin, request, {
      action: "AMIPS_REFRESH",
      entityType: "AmipsPage",
      entityId: "batch",
      metadata: {
        requeued: result.requeued,
        candidates: result.candidates,
        sourceRefreshError: result.sourceRefreshError,
      },
    });
    return adminSuccess(result);
  } catch (err) {
    logger.error("[amips-refresh] admin route error:", err);
    return adminError("REFRESH_FAILED", (err as Error).message, 500);
  }
}
