// PATCH /api/dealer/settings — dealer notification preferences.
//
// Per-notification preferences are NOT implemented yet: there are no schema
// columns for them and no send-path consumes them. This endpoint previously
// returned { updated: true } without persisting anything, which made the UI
// falsely report a successful save. Until the preference is wired end-to-end it
// responds honestly with 501 rather than faking success. The dealer settings UI
// shows these controls as a disabled "coming soon" preview and does not call it.
import { NextRequest } from "next/server";
import { getRequestDealer, errorResponse } from "@/lib/auth/dealer-api";

export async function PATCH(request: NextRequest) {
  const dealer = await getRequestDealer(request);
  if (!dealer) return errorResponse("UNAUTHORIZED", "Not authenticated", 401);

  return errorResponse(
    "NOT_IMPLEMENTED",
    "Notification preferences aren't available yet.",
    501,
  );
}
