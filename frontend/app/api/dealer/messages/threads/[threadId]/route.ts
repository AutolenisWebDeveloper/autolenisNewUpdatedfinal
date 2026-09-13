// GET  /api/dealer/messages/threads/[threadId] — load messages for a thread
// POST /api/dealer/messages/threads/[threadId] — send a reply to a thread
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { sendMessage } from "@/lib/services/messaging/messaging.service";
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

  // §25.2 / DEFECT 7 — the SECOND dealer writer, scanned for the same reason as the first.
  // Both went straight to `prisma.message.create` with `isRedacted: false` hard-coded, and there
  // is no Prisma middleware that could have caught either (`lib/prisma.ts` is a bare
  // `new PrismaClient`), so the bypass was total rather than partial.
  const message = await sendMessage(threadId, dealer.userId, parsed.data.content);

  return successResponse(
    {
      message: {
        id: message.id,
        threadId: message.threadId,
        senderId: dealer.userId,
        senderRole: "DEALER",
        // The REDACTED body when a pattern matched — what the buyer will see. Echoing the
        // original back would tell the dealership their message went through intact.
        content: message.isRedacted
          ? "[Message redacted — possible policy violation]"
          : parsed.data.content,
        isRedacted: message.isRedacted,
        sentAt: message.sentAt.toISOString(),
      },
      ...(message.isRedacted
        ? {
            notice:
              "Your message was held back because it looked like contact details or an " +
              "off-platform arrangement. Keep the conversation on AutoLenis — buyer contact " +
              "details are released to the winning dealership at reaffirmation.",
          }
        : {}),
    },
    201,
  );
}
