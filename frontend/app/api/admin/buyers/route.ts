import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { getAdminBuyerListData, getAdminBuyerKpis } from "@/lib/services/admin/admin-buyer-command-center.service";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q") ?? undefined;
  const onboardingStatus = searchParams.get("onboardingStatus") ?? undefined;
  const exceptionOnly = searchParams.get("exceptionOnly") === "true";
  const prequalStatus = searchParams.get("prequalStatus") ?? undefined;
  const hasActiveDeal = searchParams.get("hasActiveDeal") === "true";
  const hasActiveAuction = searchParams.get("hasActiveAuction") === "true";
  const registeredAfter = searchParams.get("registeredAfter") ?? undefined;
  const registeredBefore = searchParams.get("registeredBefore") ?? undefined;
  const lifecycleStatus = searchParams.get("lifecycleStatus") ?? "active";
  const page = parseInt(searchParams.get("page") ?? "1", 10);
  const perPage = Math.min(parseInt(searchParams.get("perPage") ?? "50", 10), 100);
  const includeKpis = searchParams.get("kpis") === "true";

  try {
    const [listData, kpis] = await Promise.all([
      getAdminBuyerListData({
        q, onboardingStatus, exceptionOnly, prequalStatus,
        hasActiveDeal, hasActiveAuction, registeredAfter, registeredBefore,
        lifecycleStatus, page, perPage,
      }),
      includeKpis ? getAdminBuyerKpis() : Promise.resolve(null),
    ]);

    return adminSuccess(kpis ? { ...listData, kpis } : listData);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load buyer data";
    return adminError("DB_ERROR", message, 500);
  }
}
