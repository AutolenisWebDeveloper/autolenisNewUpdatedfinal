import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { MAX_SAVED_SEARCHES } from "@/lib/constants";
import { z } from "zod";

const schema = z.object({ name: z.string().min(1), filters: z.record(z.unknown()) });

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const searches = await prisma.savedSearch.findMany({ where: { buyerId: buyer.id }, orderBy: { createdAt: "desc" } });
  return successResponse({ searches });
}

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid input", 400);

  const count = await prisma.savedSearch.count({ where: { buyerId: buyer.id } });
  if (count >= MAX_SAVED_SEARCHES) return errorResponse("LIMIT_REACHED", `Max ${MAX_SAVED_SEARCHES} saved searches`, 400);

  const search = await prisma.savedSearch.create({ data: { buyerId: buyer.id, name: parsed.data.name, filters: parsed.data.filters as object } });
  return successResponse({ search }, 201);
}
