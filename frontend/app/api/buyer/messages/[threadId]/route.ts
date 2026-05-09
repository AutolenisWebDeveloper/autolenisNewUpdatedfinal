// GET /api/buyer/messages/[threadId] — fetch thread messages (buyer must be participant)

import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { threadId } = await params;

  // Verify buyer is a participant
  const participant = await prisma.messageThreadParticipant.findUnique({
    where: { threadId_userId: { threadId, userId: buyer.userId } },
  });
  if (!participant) return errorResponse("FORBIDDEN", "Not a participant in this thread", 403);

  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      participants: { select: { userId: true, role: true } },
    },
  });

  if (!thread) return errorResponse("NOT_FOUND", "Thread not found", 404);

  // Mark thread as read for this buyer
  await prisma.messageThreadParticipant.update({
    where: { threadId_userId: { threadId, userId: buyer.userId } },
    data: { lastReadAt: new Date() },
  }).catch(() => null); // Non-fatal

  return successResponse({ thread });
}
