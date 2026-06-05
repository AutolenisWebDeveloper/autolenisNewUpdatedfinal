// GET /api/admin/analytics — Group 6 admin analytics snapshot.
// Read-only. Returns the combined KPI snapshot for the analytics dashboard.
// Each underlying query degrades to a zero state internally, so a partial DB
// failure still yields a well-formed response rather than a 500.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getAdminAnalyticsSnapshot } from "@/lib/services/analytics/admin-analytics.service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Admin authentication required", 401);

  try {
    const snapshot = await getAdminAnalyticsSnapshot();
    return new Response(JSON.stringify({ success: true, data: snapshot }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[group-6] analytics route failed", err);
    return adminError("ANALYTICS_FAILED", "Failed to load analytics", 500);
  }
}
