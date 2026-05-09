// POST /api/buyer/messages — buyer sends a new message to support (creates thread if needed)
// GET  /api/buyer/messages — list buyer's threads

import { NextRequest } from "next/server";
import { getRequestBuyer } from "@/lib/auth/api";
import { successResponse, errorResponse } from "@/lib/auth/api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const sendSchema = z.object({
  content: z.string().min(1).max(4000),
  threadId: z.string().uuid().optional(),
});

export async function GET(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const threads = await prisma.messageThread.findMany({
    where: {
      participants: { some: { userId: buyer.userId } },
    },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 20,
    include: {
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
      participants: { select: { userId: true, role: true } },
    },
  });

  return successResponse({ threads });
}

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("BAD_REQUEST", "Invalid JSON", 400);
  }

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const { content, threadId } = parsed.data;

  if (threadId) {
    // Verify buyer is a participant in this thread
    const participant = await prisma.messageThreadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId: buyer.userId } },
    });
    if (!participant) return errorResponse("FORBIDDEN", "Not a participant in this thread", 403);

    const thread = await prisma.messageThread.findUnique({ where: { id: threadId } });
    if (!thread) return errorResponse("NOT_FOUND", "Thread not found", 404);
    if (thread.status === "CLOSED") return errorResponse("THREAD_CLOSED", "Thread is closed", 400);

    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { threadId, senderId: buyer.userId, content },
      }),
      prisma.messageThread.update({
        where: { id: threadId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return successResponse({ message }, 201);
  }

  // No threadId — create a new support thread
  const thread = await prisma.messageThread.create({
    data: {
      status: "ACTIVE",
      lastMessageAt: new Date(),
      participants: {
        create: [{ userId: buyer.userId, role: "BUYER" }],
      },
      messages: {
        create: { senderId: buyer.userId, content },
      },
    },
    include: {
      messages: true,
      participants: true,
    },
  });

  return successResponse({ thread }, 201);
}
