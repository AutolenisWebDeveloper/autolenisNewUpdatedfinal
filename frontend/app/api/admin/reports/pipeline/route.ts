import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getRevenuePipeline } from "@/lib/services/analytics/analytics.service";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const pipeline = await getRevenuePipeline();
  return adminSuccess(pipeline);
}
