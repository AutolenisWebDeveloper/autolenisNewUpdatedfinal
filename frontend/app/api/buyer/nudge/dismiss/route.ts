import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const schema = z.object({ stage: z.string().min(1) });

// POST /api/buyer/nudge/dismiss
// Dismisses the latest undismissed NudgeEvent for the given stage.
export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("BAD_REQUEST", "Invalid JSON", 400); }

  const parsed = schema.safeParse(body);
  if (!parsed.success) return errorResponse("BAD_REQUEST", "stage is required", 400);

  const { stage } = parsed.data;

  const nudge = await prisma.nudgeEvent.findFirst({
    where: { buyerId: buyer.id, stage, dismissedAt: null },
    orderBy: { triggeredAt: "desc" },
  });

  if (nudge) {
    await prisma.nudgeEvent.update({
      where: { id: nudge.id },
      data: { dismissedAt: new Date() },
    });
  }

  return successResponse({ dismissed: true });
}
