// GET  /api/admin/messages/[threadId]  — fetch thread + messages
// POST /api/admin/messages/[threadId]  — admin replies to thread

import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const replySchema = z.object({
  content: z.string().min(1).max(4000),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { threadId } = await params;

  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: {
      messages: { orderBy: { sentAt: "asc" } },
      participants: { select: { userId: true, role: true, lastReadAt: true } },
    },
  });

  if (!thread) return adminError("NOT_FOUND", "Thread not found", 404);

  // Look up buyer info
  const buyerParticipant = thread.participants.find(p => p.role === "BUYER");
  const buyer = buyerParticipant
    ? await prisma.buyer.findUnique({
        where: { userId: buyerParticipant.userId },
        select: { firstName: true, lastName: true, userId: true },
      })
    : null;

  return adminSuccess({ thread, buyer });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ threadId: string }> }
) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { threadId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return adminError("BAD_REQUEST", "Invalid JSON", 400);
  }

  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return adminError("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }

  // Verify thread exists
  const thread = await prisma.messageThread.findUnique({
    where: { id: threadId },
    include: { participants: true },
  });
  if (!thread) return adminError("NOT_FOUND", "Thread not found", 404);
  if (thread.status === "CLOSED") return adminError("THREAD_CLOSED", "Thread is closed", 400);

  // Get admin user record
  const adminUser = await prisma.admin.findUnique({
    where: { id: admin.adminId },
    include: { user: true },
  });
  if (!adminUser) return adminError("NOT_FOUND", "Admin record not found", 404);

  // Ensure admin is a participant; add if not
  const alreadyParticipant = thread.participants.some(p => p.userId === adminUser.userId);
  if (!alreadyParticipant) {
    await prisma.messageThreadParticipant.create({
      data: { threadId, userId: adminUser.userId, role: "ADMIN" },
    });
  }

  const [message] = await prisma.$transaction([
    prisma.message.create({
      data: {
        threadId,
        senderId: adminUser.userId,
        content: parsed.data.content,
      },
    }),
    prisma.messageThread.update({
      where: { id: threadId },
      data: { lastMessageAt: new Date() },
    }),
  ]);

  await createAuditLog(admin, request, {
    action: "ADMIN_MESSAGE_REPLY_SENT",
    entityType: "MessageThread",
    entityId: threadId,
    metadata: { messageId: message.id, contentLength: parsed.data.content.length },
  });

  return adminSuccess({ message }, 201);
}
