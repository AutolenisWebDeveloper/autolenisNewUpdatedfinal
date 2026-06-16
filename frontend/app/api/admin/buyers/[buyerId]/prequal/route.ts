// GET /api/admin/buyers/[buyerId]/prequal
// Returns current prequal status, consent status, and buyer data readiness.
// Used by the admin prequalification panel to determine what actions are available.
//
// NOTE — There is intentionally NO POST handler on this route. Manual override
// is performed exclusively at /api/admin/buyers/[buyerId]/prequal/manual-override,
// which enforces the OFAC hard gate and the canonical operational-role policy.
// For real provider runs, use /api/admin/buyers/[buyerId]/prequal/run-ipredict.

import { logger } from "@/lib/logger";
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";

interface Props { params: Promise<{ buyerId: string }> }

export async function GET(request: NextRequest, { params }: Props) {
  const { buyerId } = await params;
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const { getAdminPrequalReadiness } = await import(
      "@/lib/services/prequal/admin-prequal.service"
    );
    const readiness = await getAdminPrequalReadiness(buyerId);
    return adminSuccess(readiness);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    if (msg === "Buyer not found") return adminError("NOT_FOUND", "Buyer not found", 404);
    logger.error("[admin/prequal GET]", err);
    return adminError("SERVER_ERROR", "Failed to load prequal readiness", 500);
  }
}
