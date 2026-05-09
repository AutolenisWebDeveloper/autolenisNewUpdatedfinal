import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ dealId: z.string(), rating: z.number().int().min(1).max(5), text: z.string().min(10).max(500) });

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);
  const body = await request.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", "Invalid input", 400);

  const deal = await prisma.deal.findFirst({ where: { id: parsed.data.dealId, buyerId: buyer.id, status: "COMPLETED" } });
  if (!deal) return errorResponse("NOT_FOUND", "Completed deal not found", 404);

  const testimonial = await prisma.testimonial.create({
    data: { buyerId: buyer.id, dealId: parsed.data.dealId, rating: parsed.data.rating, text: parsed.data.text },
  });
  return successResponse({ testimonial }, 201);
}
