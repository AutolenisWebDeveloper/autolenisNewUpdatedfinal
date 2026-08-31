// POST /api/admin/ai/chat — Zura, admin surface.
//
// Two things this route does that no other chat route does, both preserved:
//   • it passes the ADMIN IDENTITY AND ROLE into the turn, which the previous
//     `adminConciergeChat(message, history)` signature could not express — so
//     per-role scoping was not even representable (Phase 1 §D.4);
//   • it keeps its existing `ADMIN_AI_CHAT` write to `admin_audit_logs`,
//     unchanged. The unified AI trail in `audit_logs` is written by the shared
//     service IN ADDITION. That double-write is deliberate: routing admin AI
//     events only to the admin trail would leave the AI trail with a hole
//     exactly where the highest-privilege actor is.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import { clientIpKey } from "@/lib/security/rate-limit";
import { runZuraTurn } from "@/lib/services/ai/zura-chat.service";
import type { AuthenticatedRole } from "@/lib/services/ai/action-intent";

const SURFACE = "admin" as const;

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  let body: { message?: unknown; history?: unknown; pageLabel?: unknown; chatSessionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const message = typeof body.message === "string" ? body.message : "";

  const result = await runZuraTurn({
    surface: SURFACE,
    actor: {
      actorType: "ADMIN",
      actorId: admin.adminId,
      // `AdminRole` and `AuthenticatedRole` share the five admin members, which
      // is why §5.5 needed no new vocabulary.
      authenticatedRole: admin.role as AuthenticatedRole,
      actorEmail: admin.email,
    },
    message,
    history: body.history,
    location: { pageLabel: typeof body.pageLabel === "string" ? body.pageLabel : undefined },
    chatSessionId: typeof body.chatSessionId === "string" ? body.chatSessionId : undefined,
    clientIp: clientIpKey(request.headers),
  });

  if (!result.ok) {
    const status =
      result.status ??
      (result.code === "VALIDATION_ERROR" ? 400 : result.code === "AI_ERROR" ? 500 : 503);
    return adminError(result.code, result.message, status);
  }

  await createAuditLog(admin, request, {
    action: "ADMIN_AI_CHAT",
    entityType: "AdminConcierge",
    entityId: admin.adminId,
    metadata: {
      model: result.model,
      message_length: message.length,
      history_length: Array.isArray(body.history) ? body.history.length : 0,
    },
  });

  return adminSuccess({
    content: result.content,
    model: result.model,
    chatSessionId: result.chatSessionId,
    ...(result.proposal ? { proposal: result.proposal } : {}),
  });
}
