import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import {
  getAdminAffiliateListData,
  getAdminAffiliateKpis,
} from "@/lib/services/admin/admin-affiliate-command-center.service";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const filters = {
    q: searchParams.get("q") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    level: searchParams.get("level") ? Number(searchParams.get("level")) : undefined,
    page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
    perPage: searchParams.get("perPage") ? Number(searchParams.get("perPage")) : undefined,
  };

  try {
    const [kpis, listData] = await Promise.all([
      getAdminAffiliateKpis(),
      getAdminAffiliateListData(filters),
    ]);
    return adminSuccess({ kpis, ...listData });
  } catch (err) {
    return adminError("FETCH_FAILED", err instanceof Error ? err.message : "Failed to fetch affiliates", 500);
  }
}
