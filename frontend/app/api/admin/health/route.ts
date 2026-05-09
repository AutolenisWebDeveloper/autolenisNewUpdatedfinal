import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { runHealthCheck } from "@/lib/services/monitoring/health.service";

export const dynamic = "force-dynamic";

// GET /api/admin/health — system health check for admin console
export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const report = await runHealthCheck();
  return adminSuccess({ report });
}
