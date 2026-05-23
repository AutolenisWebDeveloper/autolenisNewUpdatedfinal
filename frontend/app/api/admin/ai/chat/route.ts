// POST /api/admin/ai/chat — Admin concierge (Zura)
// Groq ONLY | Kill switch | Admin auth required (MFA verified)
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { adminConciergeChat } from "@/lib/services/ai/admin-concierge.agent";
import type { ChatMessage } from "@/lib/ai/groq-client";
import { isAiEnabled } from "@/lib/ai/kill-switch";

export async function POST(request: NextRequest) {
  if (!isAiEnabled()) {
    return adminError("AI_DISABLED", "AI services are currently unavailable", 503);
  }

  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const body = await request.json() as {
    message: string;
    history?: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!body.message?.trim()) {
    return adminError("VALIDATION_ERROR", "message is required", 400);
  }

  try {
    const result = await adminConciergeChat(
      body.message,
      (body.history ?? []) as ChatMessage[]
    );
    await createAuditLog(admin, request, {
      action: "ADMIN_AI_CHAT",
      entityType: "AdminConcierge",
      entityId: admin.adminId,
      metadata: { model: result.model, message_length: body.message.length, history_length: body.history?.length ?? 0 },
    });
    return adminSuccess({ content: result.content, model: result.model });
  } catch (err) {
    const msg = String(err);
    if (msg.includes("AI_KILL_SWITCH") || msg.includes("kill-switch")) {
      return adminError("AI_DISABLED", "AI services are currently unavailable", 503);
    }
    if (msg.includes("GROQ_API_KEY") || msg.includes("not configured")) {
      return adminError("AI_NOT_CONFIGURED", "AI service not configured", 503);
    }
    return adminError("AI_ERROR", "AI service error — please try again", 500);
  }
}
