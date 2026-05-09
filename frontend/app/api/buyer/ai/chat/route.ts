import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { buyerConciergChat } from "@/lib/services/ai/buyer-concierge.agent";
import type { ChatMessage } from "@/lib/ai/groq-client";
import { isAiEnabled } from "@/lib/ai/kill-switch";
import { prisma } from "@/lib/prisma";

// POST /api/buyer/ai/chat — Buyer AI concierge (Groq ONLY)
export async function POST(request: NextRequest) {
  // Check AI kill switch first
  if (!isAiEnabled()) {
    return errorResponse("AI_DISABLED", "AI services are currently unavailable", 503);
  }

  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const { message, history, agentType } = await request.json() as {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
    agentType?: string;
  };

  if (!message?.trim()) return errorResponse("VALIDATION_ERROR", "message is required", 400);

  try {
    const result = await buyerConciergChat(
      buyer.id,
      message,
      (history ?? []) as ChatMessage[]
    );

    // Log conversation for cross-session memory (AiConversationContext — System 16 ENH)
    await prisma.buyerActivityEvent.create({
      data: {
        buyerId: buyer.id,
        eventType: "AI_CHAT",
        title: "Chatted with AutoLenis concierge",
        metadata: { messagePreview: message.slice(0, 50), agentType: agentType ?? "general" },
      },
    }).catch(() => {}); // Non-blocking

    return successResponse({ content: result.content, model: result.model });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("kill-switch") || msg.includes("KILL_SWITCH")) {
      return errorResponse("AI_DISABLED", "AI services are currently unavailable", 503);
    }
    if (msg.includes("GROQ_API_KEY") || msg.includes("not configured")) {
      return errorResponse("AI_NOT_CONFIGURED", "AI service not yet configured", 503);
    }
    return errorResponse("AI_ERROR", "AI service error — please try again", 500);
  }
}
