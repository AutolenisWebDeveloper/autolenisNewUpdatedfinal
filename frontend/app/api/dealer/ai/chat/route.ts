// POST /api/dealer/ai/chat — Zura, dealer surface.
//
// Dealer isolation now holds BY RULE rather than by the accident of no buyer
// data being assembled: the dealer context is keyed on the server-resolved
// dealer id, and the dealer persona states outright that no buyer budget is
// visible (the previous prompt claimed the opposite — Phase 2 §8.5 #8).
import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { clientIpKey } from "@/lib/security/rate-limit";
import { runZuraTurn } from "@/lib/services/ai/zura-chat.service";

const SURFACE = "dealer" as const;

export async function POST(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: { message?: unknown; history?: unknown; pageLabel?: unknown; chatSessionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const result = await runZuraTurn({
    surface: SURFACE,
    actor: { actorType: "DEALER", actorId: dealer.id, authenticatedRole: "DEALER" },
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
