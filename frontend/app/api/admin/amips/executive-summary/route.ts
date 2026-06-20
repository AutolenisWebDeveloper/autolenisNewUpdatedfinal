import { NextRequest } from "next/server";
import {
  getAdminFromRequest,
  adminSuccess,
  adminError,
  createAuditLog,
} from "@/lib/auth/admin-api";
import { loadExecutiveIntelligence } from "@/lib/amips/intelligence/executive-intelligence";
import { generateExecutiveSummary } from "@/lib/amips/intelligence/narrative";
import { isAiEnabled } from "@/lib/ai/kill-switch";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hard cap below the platform function limit so a slow upstream returns a clean
// JSON error instead of a Vercel HTML timeout page (which breaks res.json()).
const AI_TIMEOUT_MS = 45_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("AI request timed out — please try again")), ms),
    ),
  ]);
}

// POST — generate the AI executive narrative over the current intelligence.
// On-demand (button-triggered) so the dashboard stays fast and AI cost is
// incurred only when an operator asks for the briefing. Always returns JSON.
export async function POST(request: NextRequest) {
  try {
    const admin = await getAdminFromRequest(request);
    if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

    if (!isAiEnabled()) {
      return adminError("AI_DISABLED", "AI is currently disabled by the kill switch.", 503);
    }
    const key = process.env.GROQ_API_KEY;
    if (!key || key.startsWith("gsk_placeholder")) {
      return adminError(
        "AI_NOT_CONFIGURED",
        "The AI provider is not configured (GROQ_API_KEY missing). The rest of the dashboard is unaffected.",
        503,
      );
    }

    const intel = await loadExecutiveIntelligence();
    const summary = await withTimeout(generateExecutiveSummary(intel), AI_TIMEOUT_MS);

    await createAuditLog(admin, request, {
      action: "AMIPS_EXECUTIVE_SUMMARY_GENERATED",
      entityType: "AmipsIntelligence",
      entityId: "executive-summary",
      metadata: { model: summary.model, healthScore: intel.health.score },
    });

    return adminSuccess(summary);
  } catch (err) {
    logger.error("[amips-executive-summary] failed:", err);
    return adminError("SUMMARY_FAILED", (err as Error).message || "Failed to generate briefing", 500);
  }
}
