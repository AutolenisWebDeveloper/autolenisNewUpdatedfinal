// GET /api/admin/action-intents — list ActionIntents awaiting human approval.
//
// Thin transport. Dormant by default (the ActionIntent surface must be enabled),
// admin-authenticated, server-side response shaping (no secrets/PII beyond the
// validated business parameters). No business logic here.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError } from "@/lib/auth/admin-api";
import { isActionIntentSurfaceEnabled, createDurableEngineDeps, shapeIntentForAdmin } from "@/lib/services/ai/action-intent";

export async function GET(request: NextRequest) {
  // Dormant gate: while the surface is off, this endpoint does not exist.
  if (!isActionIntentSurfaceEnabled()) {
    return adminError("NOT_FOUND", "Not found", 404);
  }
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  try {
    const deps = createDurableEngineDeps();
    const pending = await deps.store.listByStatus("APPROVAL_REQUIRED");
    return adminSuccess({ intents: pending.map(shapeIntentForAdmin) });
  } catch {
    return adminError("ACTION_INTENT_ERROR", "Failed to list action intents", 500);
  }
}
