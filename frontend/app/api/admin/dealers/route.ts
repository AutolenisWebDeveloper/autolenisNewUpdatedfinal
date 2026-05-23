import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import {
  getAdminDealerListData,
  getAdminDealerKpis,
} from "@/lib/services/admin/admin-dealer-command-center.service";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const filters = {
    q: searchParams.get("q") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    tier: searchParams.get("tier") ?? undefined,
    inventoryType: searchParams.get("inventoryType") ?? undefined,
    serviceArea: searchParams.get("serviceArea") ?? undefined,
    page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
    perPage: searchParams.get("perPage") ? Number(searchParams.get("perPage")) : undefined,
  };

  try {
    const [kpis, listData] = await Promise.all([
      getAdminDealerKpis(),
      getAdminDealerListData(filters),
    ]);
    return adminSuccess({ kpis, ...listData });
  } catch (err) {
    return adminError("FETCH_FAILED", err instanceof Error ? err.message : "Failed to fetch dealers", 500);
  }
}
