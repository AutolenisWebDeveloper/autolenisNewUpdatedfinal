// POST /api/dealer/ai/chat — Dealer AI concierge (Zura)
// Groq ONLY | Kill switch | Dealer auth required
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { dealerConciergeChat } from "@/lib/services/ai/dealer-concierge.agent";
import type { ChatMessage } from "@/lib/ai/groq-client";
import { isAiEnabled } from "@/lib/ai/kill-switch";

export async function POST(request: NextRequest) {
  if (!isAiEnabled()) {
    return errorResponse("AI_DISABLED", "AI services are currently unavailable", 503);
  }

  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json() as {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!body.message?.trim()) {
    return errorResponse("VALIDATION_ERROR", "message is required", 400);
  }

  try {
    const result = await dealerConciergeChat(
      dealer.id,
      body.message,
      (body.history ?? []) as ChatMessage[]
    );
    return successResponse({ content: result.content, model: result.model });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("AI_KILL_SWITCH") || msg.includes("kill-switch")) {
      return errorResponse("AI_DISABLED", "AI services are currently unavailable", 503);
    }
    if (msg.includes("GROQ_API_KEY") || msg.includes("not configured")) {
      return errorResponse("AI_NOT_CONFIGURED", "AI service not configured", 503);
    }
    return errorResponse("AI_ERROR", "AI service error — please try again", 500);
  }
}
