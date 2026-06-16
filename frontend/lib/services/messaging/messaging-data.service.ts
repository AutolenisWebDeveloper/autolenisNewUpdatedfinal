// lib/services/messaging/messaging-data.service.ts — Feature 33 read queries
// Prisma read queries for buyer-facing messaging pages.
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

export type BuyerThreadSummary = {
  id: string;
  status: string;
  lastMessageAt: Date | null;
  dealId: string | null;
  requestId: string | null;
  messages: Array<{
    content: string;
    isRedacted: boolean;
    sentAt: Date;
    senderId: string;
  }>;
  participants: Array<{ userId: string; role: string; lastReadAt: Date | null }>;
};

export type BuyerThreadDetail = {
  id: string;
  status: string;
  lastMessageAt: Date | null;
  messages: Array<{
    id: string;
    content: string;
    isRedacted: boolean;
    sentAt: Date;
    senderId: string;
  }>;
  participants: Array<{ userId: string; role: string }>;
};

export async function getBuyerMessageThreads(buyerUserId: string): Promise<BuyerThreadSummary[]> {
  const threads = await prisma.messageThread.findMany({
    where: { participants: { some: { userId: buyerUserId } } },
    include: {
      messages: { orderBy: { sentAt: "desc" }, take: 1 },
      participants: { select: { userId: true, role: true, lastReadAt: true } },
    },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: 20,
  });

  return threads.map((t) => ({
    id: t.id,
    status: t.status as string,
    lastMessageAt: t.lastMessageAt,
    dealId: t.dealId,
    requestId: t.requestId,
    messages: t.messages.map((m) => ({
      content: m.content,
      isRedacted: m.isRedacted,
      sentAt: m.sentAt,
      senderId: m.senderId,
    })),
    participants: t.participants.map((p) => ({
      userId: p.userId,
      role: p.role,
      lastReadAt: p.lastReadAt,
    })),
  }));
}

export async function getBuyerMessageThread(
  buyerUserId: string,
  threadId: string
): Promise<BuyerThreadDetail | null> {
  // Verify buyer is a participant
  const participant = await prisma.messageThreadParticipant.findUnique({
    where: { threadId_userId: { threadId, userId: buyerUserId } },
  });
  if (!participant) return null;

  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      participants: { select: { userId: true, role: true } },
    },
  });
  if (!thread) return null;

  // Mark as read (non-fatal)
  await prisma.messageThreadParticipant
    .update({
      where: { threadId_userId: { threadId, userId: buyerUserId } },
      data: { lastReadAt: new Date() },
    })
    .catch((err) => logger.error("[messaging-data] mark-read failed:", err));

  return {
    id: thread.id,
    status: thread.status as string,
    lastMessageAt: thread.lastMessageAt,
    messages: thread.messages.map((m) => ({
      id: m.id,
      content: m.content,
      isRedacted: m.isRedacted,
      sentAt: m.sentAt,
      senderId: m.senderId,
    })),
    participants: thread.participants,
  };
}
