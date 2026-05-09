import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({
  weeklyDigestEnabled: z.boolean(),
});

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("VALIDATION_ERROR", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);

  await prisma.affiliate.update({
    where: { id: affiliate.id },
    data: { weeklyDigestEnabled: parsed.data.weeklyDigestEnabled },
  });

  return successResponse({ weeklyDigestEnabled: parsed.data.weeklyDigestEnabled });
}
