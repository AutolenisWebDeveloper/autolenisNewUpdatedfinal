// POST /api/dealer/messages — dealer sends a message to a buyer in a deal thread.
// Body: { threadId?, dealId?, content }. Either threadId OR dealId required.
// If dealId is supplied without threadId, finds-or-creates the dealer/buyer thread for that deal.

import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export const dynamic = "force-dynamic";

const schema = z.object({
  threadId: z.string().optional(),
  dealId: z.string().optional(),
  content: z.string().min(1).max(2000),
}).refine((d) => d.threadId || d.dealId, { message: "threadId or dealId is required" });

async function findOrCreateThread(dealerId: string, dealerUserId: string, dealId: string): Promise<string> {
  const existing = await prisma.messageThread.findFirst({
    where: { dealId, participants: { some: { userId: dealerUserId } } },
  });
  if (existing) return existing.id;

  // IDOR guard: a dealer may only open a thread on a deal they own. Ownership
  // flows through the offer relation (Deal.offer.dealerId). Scoping here means a
  // dealId belonging to another dealer's offer resolves to null → DEAL_NOT_FOUND
  // → 404, never leaking that the deal exists. findFirst (not findUnique) is
  // required because the where-clause filters on the offer relation.
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, offer: { dealerId } },
    include: { buyer: { include: { user: true } } },
  });
  if (!deal) throw new Error("DEAL_NOT_FOUND");

  const thread = await prisma.messageThread.create({
    data: {
      dealId,
      lastMessageAt: new Date(),
      participants: {
        create: [
          { userId: dealerUserId, role: "DEALER" },
          { userId: deal.buyer.user.id, role: "BUYER" },
        ],
      },
    },
  });
  return thread.id;
}

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid input", 400);
  }
  const { content } = parsed.data;
  let { threadId } = parsed.data;

  if (!threadId) {
    try {
      threadId = await findOrCreateThread(dealer.id, dealer.userId, parsed.data.dealId!);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "THREAD_ERROR";
      return errorResponse(msg === "DEAL_NOT_FOUND" ? "DEAL_NOT_FOUND" : "THREAD_ERROR",
        msg === "DEAL_NOT_FOUND" ? "Deal not found" : "Could not create thread", msg === "DEAL_NOT_FOUND" ? 404 : 500);
    }
  } else {
    // Verify dealer is a participant
    const part = await prisma.messageThreadParticipant.findFirst({
      where: { threadId, userId: dealer.userId },
    });
    if (!part) return errorResponse("NOT_A_PARTICIPANT", "You are not a participant in this thread", 403);
  }

  const message = await prisma.message.create({
    data: {
      threadId,
      senderId: dealer.userId,
      content,
      isRedacted: false,
    },
  });

  await prisma.messageThread.update({
    where: { id: threadId },
    data: { lastMessageAt: new Date() },
  });

  return successResponse({ messageId: message.id, threadId, sentAt: message.sentAt }, 201);
}
