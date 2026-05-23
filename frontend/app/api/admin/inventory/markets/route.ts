import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ city: z.string().min(1), state: z.string().length(2), zip: z.string().min(5) });

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const markets = await prisma.marketCoverage.findMany({ orderBy: { city: "asc" } });
  return adminSuccess({ markets });
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return adminError("VALIDATION_ERROR", parsed.error.message, 400);
  const market = await prisma.marketCoverage.upsert({ where: { city_state: { city: parsed.data.city, state: parsed.data.state } }, create: parsed.data, update: {} });
  await createAuditLog(admin, request, {
    action: "INVENTORY_MARKET_UPSERTED",
    entityType: "MarketCoverage",
    entityId: market.id,
    metadata: { city: parsed.data.city, state: parsed.data.state, zip: parsed.data.zip },
  });
  return adminSuccess({ market }, 201);
}
