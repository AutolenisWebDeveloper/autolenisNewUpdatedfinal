// POST /api/admin/action-intents/[id]/approve — server-authoritative human
// approval of a pending consequential ActionIntent.
//
// Thin transport. The route ONLY: gates on the dormant switch, authenticates
// the admin, constructs the approver ActorContext from the SESSION (never from
// the request body / conversational text), and calls the engine. ALL rules —
// the AI/SYSTEM-cannot-approve invariant, the per-intent RBAC approver
// permission (money → SUPER/FINANCE), deterministic revalidation of stale
// state, the atomic execution claim, and canonical-service execution — live in
// deterministic engine/policy code, not here.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import {
  isActionIntentSurfaceEnabled,
  createDurableEngineDeps,
  approveIntent,
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
  const deps = createDurableEngineDeps();

  // Approver identity comes from the authenticated session — never the body.
  const approver: ActorContext = {
    actorType: "ADMIN",
    actorId: admin.adminId,
    authenticatedRole: admin.role,
    actorEmail: admin.email,
  };

  try {
    const outcome = await approveIntent(id, approver, deps);
    await createAuditLog(admin, request, {
      action: "ACTION_INTENT_APPROVED",
      entityType: "AiActionIntent",
      entityId: id,
      metadata: { outcomeStatus: outcome.status },
    });
    const record = await deps.store.get(id);
    return adminSuccess({ outcome, intent: record ? shapeIntentForAdmin(record) : null });
  } catch (err) {
    if (err instanceof ActionIntentRejected) {
      // Fail closed: unauthorized approver / self-approval / wrong state.
      const status = err.code === "INVALID_STATE" ? 409 : 403;
      return adminError(err.code, err.message, status);
    }
    return adminError("ACTION_INTENT_ERROR", "Failed to approve action intent", 500);
  }
}
