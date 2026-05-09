import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const markets = await prisma.marketCoverage.findMany({ where: { status: "ACTIVE" }, orderBy: { city: "asc" } });
  const data = markets.map(m => ({ city: m.city, state: m.state, zip: m.zip, listingCount: m.listingCount, lat: null, lng: null }));
  return adminSuccess({ markets: data });
}
