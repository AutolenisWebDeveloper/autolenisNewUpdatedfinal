// POST /api/admin/action-intents/[id]/reject — server-authoritative human
// rejection of a pending ActionIntent. Thin transport; the engine enforces that
// the AI/SYSTEM actor can never resolve an intent and that only a pending
// intent can be rejected. No consequential side effect occurs on rejection.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import {
  isActionIntentSurfaceEnabled,
  createDurableEngineDeps,
  rejectIntent,
  shapeIntentForAdmin,
  ActionIntentRejected,
  type ActorContext,
} from "@/lib/services/ai/action-intent";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  if (!isActionIntentSurfaceEnabled()) {
    return adminError("NOT_FOUND", "Not found", 404);
  }
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { reason?: string };
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim().slice(0, 500) : "Rejected by admin";

  const deps = createDurableEngineDeps();
  const approver: ActorContext = {
    actorType: "ADMIN",
    actorId: admin.adminId,
    authenticatedRole: admin.role,
    actorEmail: admin.email,
  };

  try {
    const outcome = await rejectIntent(id, approver, reason, deps);
    await createAuditLog(admin, request, {
      action: "ACTION_INTENT_REJECTED",
      entityType: "AiActionIntent",
      entityId: id,
      metadata: { outcomeStatus: outcome.status },
    });
    const record = await deps.store.get(id);
    return adminSuccess({ outcome, intent: record ? shapeIntentForAdmin(record) : null });
  } catch (err) {
    if (err instanceof ActionIntentRejected) {
      const status = err.code === "INVALID_STATE" ? 409 : 403;
      return adminError(err.code, err.message, status);
    }
    return adminError("ACTION_INTENT_ERROR", "Failed to reject action intent", 500);
  }
}
