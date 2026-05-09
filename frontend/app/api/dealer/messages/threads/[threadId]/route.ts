// GET  /api/dealer/messages/threads/[threadId] — load messages for a thread
// POST /api/dealer/messages/threads/[threadId] — send a reply to a thread
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

interface Props {
  params: Promise<{ threadId: string }>;
}

const replySchema = z.object({
  content: z.string().min(1).max(2000),
});

export async function GET(request: NextRequest, { params }: Props) {
  const { threadId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Verify dealer is a participant
  const participant = await prisma.messageThreadParticipant.findFirst({
    where: { threadId, userId: dealer.userId },
  });
  if (!participant) return errorResponse("NOT_A_PARTICIPANT", "You are not a participant in this thread", 403);

  const rawMessages = await prisma.message.findMany({
    where: { threadId },
    orderBy: { sentAt: "asc" },
  });

  // Redact content where flagged
  const messages = rawMessages.map((m) => ({
    id: m.id,
    threadId: m.threadId,
    senderId: m.senderId,
    senderRole: participant.userId === m.senderId ? "DEALER" : "BUYER",
    content: m.isRedacted ? "[Redacted]" : m.content,
    sentAt: m.sentAt.toISOString(),
  }));

  return successResponse({ messages });
}

export async function POST(request: NextRequest, { params }: Props) {
  const { threadId } = await params;
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  // Verify dealer is a participant
  const participant = await prisma.messageThreadParticipant.findFirst({
    where: { threadId, userId: dealer.userId },
  });
  if (!participant) return errorResponse("NOT_A_PARTICIPANT", "You are not a participant in this thread", 403);

  const body = await request.json().catch(() => ({}));
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  const message = await prisma.message.create({
    data: {
      threadId,
      senderId: dealer.userId,
      content: parsed.data.content,
      isRedacted: false,
    },
  });

  await prisma.messageThread.update({
    where: { id: threadId },
    data: { lastMessageAt: new Date() },
  });

  return successResponse(
    {
      message: {
        id: message.id,
        threadId: message.threadId,
        senderId: message.senderId,
        senderRole: "DEALER",
        content: message.content,
        sentAt: message.sentAt.toISOString(),
      },
    },
    201,
  );
}
