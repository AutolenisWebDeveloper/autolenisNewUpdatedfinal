// POST /api/affiliate/ai/chat — Zura, affiliate surface.
//
// The affiliate's email no longer reaches the system prompt (Phase 2 §8.5 #9),
// and a missing affiliate row now degrades to a usable conversation instead of
// throwing a 500 (Phase 1 §A.4).
import { NextRequest } from "next/server";
import { getRequestAffiliate, successResponse, errorResponse } from "@/lib/auth/affiliate-api";
import { clientIpKey } from "@/lib/security/rate-limit";
import { runZuraTurn } from "@/lib/services/ai/zura-chat.service";

const SURFACE = "affiliate" as const;

export async function POST(request: NextRequest) {
  const affiliate = await getRequestAffiliate(request);
  if (!affiliate) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: { message?: unknown; history?: unknown; pageLabel?: unknown; chatSessionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const result = await runZuraTurn({
    surface: SURFACE,
    actor: { actorType: "AFFILIATE", actorId: affiliate.id, authenticatedRole: "AFFILIATE" },
    message: typeof body.message === "string" ? body.message : "",
    history: body.history,
    location: { pageLabel: typeof body.pageLabel === "string" ? body.pageLabel : undefined },
    chatSessionId: typeof body.chatSessionId === "string" ? body.chatSessionId : undefined,
    clientIp: clientIpKey(request.headers),
  });

  if (!result.ok) {
    const status =
      result.status ??
      (result.code === "VALIDATION_ERROR" ? 400 : result.code === "AI_ERROR" ? 500 : 503);
    return errorResponse(result.code, result.message, status);
  }

  return successResponse({
    content: result.content,
    model: result.model,
    chatSessionId: result.chatSessionId,
    ...(result.proposal ? { proposal: result.proposal } : {}),
  });
}
