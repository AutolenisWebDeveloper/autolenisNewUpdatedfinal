import { NextRequest } from "next/server";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { loadExecutiveIntelligence } from "@/lib/amips/intelligence/executive-intelligence";
import { generateExecutiveSummary } from "@/lib/amips/intelligence/narrative";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST — generate the AI executive narrative over the current intelligence.
// On-demand (button-triggered) so the dashboard stays fast and AI cost is
// incurred only when an operator asks for the briefing.
export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const intel = await loadExecutiveIntelligence();
    const summary = await generateExecutiveSummary(intel);

    await createAuditLog(admin, request, {
      action: "AMIPS_EXECUTIVE_SUMMARY_GENERATED",
      entityType: "AmipsIntelligence",
      entityId: "executive-summary",
      metadata: { model: summary.model, healthScore: intel.health.score },
    });

    return adminSuccess(summary);
  } catch (err) {
    logger.error("[amips-executive-summary] failed:", err);
    return adminError("SUMMARY_FAILED", (err as Error).message, 500);
  }
}
