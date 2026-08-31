// POST /api/buyer/ai/chat — Zura, buyer surface.
//
// Thin by design: the route establishes IDENTITY and nothing else. The surface
// key is a constant of this file — derived from the path this handler is mounted
// on — so no request body can select which brain answers. That is what retiring
// the `agentType` wire prop bought.
import { NextRequest } from "next/server";
import { getRequestBuyer, successResponse, errorResponse } from "@/lib/auth/api";
import { clientIpKey } from "@/lib/security/rate-limit";
import { runZuraTurn } from "@/lib/services/ai/zura-chat.service";
import { prisma } from "@/lib/prisma";

const SURFACE = "buyer" as const;

export async function POST(request: NextRequest) {
  const buyer = await getRequestBuyer(request);
  if (!buyer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  let body: { message?: unknown; history?: unknown; pageLabel?: unknown; chatSessionId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  const result = await runZuraTurn({
    surface: SURFACE,
    actor: { actorType: "BUYER", actorId: buyer.id, authenticatedRole: "BUYER" },
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

  // The buyer activity breadcrumb is preserved. Its `agentType` metadata field is
  // replaced by the SERVER-DERIVED `surface`, which is strictly more trustworthy:
  // `agentType` was a client-supplied string that routed nothing and was recorded
  // as if it had.
  await prisma.buyerActivityEvent
    .create({
      data: {
        buyerId: buyer.id,
        eventType: "AI_CHAT",
        title: "Chatted with AutoLenis concierge",
        metadata: {
          messagePreview: (typeof body.message === "string" ? body.message : "").slice(0, 50),
          surface: SURFACE,
        },
      },
    })
    .catch(() => {}); // Non-blocking

  return successResponse({
    content: result.content,
    model: result.model,
    chatSessionId: result.chatSessionId,
    ...(result.proposal ? { proposal: result.proposal } : {}),
  });
}
