import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/auth/api";
import { groqChat, type ChatMessage } from "@/lib/ai/groq-client";
import { isAiEnabled } from "@/lib/ai/kill-switch";
import { ZURA_SYSTEM_PROMPT } from "@/lib/ai/zura-knowledge";

// Public Zura concierge endpoint — no authentication required.
// Used by the public homepage ChatWidget for unauthenticated visitors.
import { limitGeneral, clientIpKey } from "@/lib/security/rate-limit";

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 8;

export async function POST(request: NextRequest) {
  // Kill switch first
  if (!isAiEnabled()) {
    return errorResponse("AI_DISABLED", "AI services are currently unavailable", 503);
  }

  // Durable per-IP rate limit (20/hour) — shared across serverless instances,
  // survives cold starts. Fails OPEN with an alert if the store is down.
  const rl = await limitGeneral(`chat:ip:${clientIpKey(request.headers)}`, { tokens: 20, window: "1 h" });
  if (!rl.ok) {
    return errorResponse("RATE_LIMITED", rl.message, rl.status);
  }

  let body: {
    message?: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };
  try {
    body = await request.json();
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return errorResponse("VALIDATION_ERROR", "message is required", 400);
  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse("VALIDATION_ERROR", "message is too long", 400);
  }

  // Sanitize history: only allow user/assistant roles, trim content, cap length.
  const rawHistory = Array.isArray(body.history) ? body.history : [];
  const history: ChatMessage[] = rawHistory
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_HISTORY_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_MESSAGE_LENGTH) }));

  const messages: ChatMessage[] = [
    { role: "system", content: ZURA_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: message },
  ];

  try {
    const result = await groqChat(messages, { maxTokens: 300, temperature: 0.7 });
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
