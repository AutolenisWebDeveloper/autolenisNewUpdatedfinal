import { NextRequest } from "next/server";
import { getRequestDealer, successResponse, errorResponse } from "@/lib/auth/dealer-api";
import { prisma } from "@/lib/prisma";

// F13 — GET /api/dealer/notifications
//
// PROJECTED IN PHASE 7, and the reason is a §25.1 leak that outlives its writer.
//
// The handler returned WHOLE `Notification` rows with no `select`. The DEAL_SELECTED row written
// by `lib/services/notifications/dealer-award.ts` carries the buyer's first name and last initial
// in `body`, and `metadata` carries offerId / dealId / auctionId. Phase 7 moves the identity
// release from award dispatch to reaffirmation (§11.6), which fixes what NEW rows say — and
// leaves every row already written serving the name on every poll of this endpoint.
//
// So the projection is the fix, not the writer alone. `metadata` is dropped entirely: it is an
// untyped JSON column that any future notification producer can put anything into, and a
// dealer-facing endpoint that returns it is a standing invitation to leak the next thing somebody
// stores there. The fields below are what a notification list actually renders.
export async function GET(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  const notifications = await prisma.notification.findMany({
    where: { dealerId: dealer.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      type: true,
      title: true,
      body: true,
      readAt: true,
      createdAt: true,
      actionUrl: true,
    },
  });

  const unreadCount = await prisma.notification.count({ where: { dealerId: dealer.id, readAt: null } });
  return successResponse({ notifications, unreadCount });
}
