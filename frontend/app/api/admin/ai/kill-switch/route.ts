// GET/POST /api/admin/ai/kill-switch — the runtime AI kill switch.
//
// The first admin route in this codebase that writes a FeatureFlag. It reuses
// the existing `setFeatureFlag` substrate through
// `lib/services/ai/ai-kill-switch.service.ts` rather than establishing a new
// one, and it is restricted to SUPER_ADMIN + OPERATIONS_ADMIN: disabling every
// AI capability platform-wide is an operations action, not a support one.
//
// The deploy-level `AI_KILL_SWITCH` env var is reported here but cannot be
// changed here — that is the point of having two tiers.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, createAuditLog } from "@/lib/auth/admin-api";
import {
  getAiKillSwitchState,
  setAiKillSwitch,
  canOperateKillSwitch,
} from "@/lib/services/ai/ai-kill-switch.service";
import { modelInventory } from "@/lib/ai/model-registry";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  // Reading the state is available to any authenticated admin: an operator
  // needs to know whether AI is up before they can reason about anything else.
  try {
    // The provider list is rendered from the closed `ModelId` union, so the
    // console cannot drift back into claiming a provider set the code does not
    // have (Phase 2 §3.5 property 3 / §8.4).
    return adminSuccess({ ...(await getAiKillSwitchState()), providers: modelInventory() });
  } catch (err) {
    logger.error("[admin/ai/kill-switch] state read failed:", err);
    return adminError("KILL_SWITCH_READ_FAILED", "Could not read the kill-switch state", 500);
  }
}

export async function POST(request: NextRequest) {
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);

  if (!canOperateKillSwitch(admin.role)) {
    return adminError(
      "FORBIDDEN",
      "Operating the AI kill switch requires SUPER_ADMIN or OPERATIONS_ADMIN",
      403,
    );
  }

  let body: { killed?: unknown; reason?: unknown };
  try {
    body = (await request.json()) as { killed?: unknown; reason?: unknown };
  } catch {
    return adminError("VALIDATION_ERROR", "Invalid JSON body", 400);
  }

  if (typeof body.killed !== "boolean") {
    return adminError("VALIDATION_ERROR", "killed must be a boolean", 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 500) : undefined;

  try {
    const state = await setAiKillSwitch({ killed: body.killed, adminId: admin.adminId, reason });

    // The admin trail is preserved for admin-actor actions exactly as it is
    // everywhere else in this codebase; the transactional AiKillSwitchLog row
    // written by the service is the AI-side record of the same flip.
    await createAuditLog(admin, request, {
      action: "AI_KILL_SWITCH_TOGGLE",
      entityType: "AiKillSwitch",
      entityId: "ai_kill_switch",
      reason,
      metadata: { killed: state.killed, envKilled: state.envKilled, aiEnabled: state.aiEnabled },
    }).catch((err) => logger.error("[admin/ai/kill-switch] admin audit write failed:", err));

    return adminSuccess(state);
  } catch (err) {
    logger.error("[admin/ai/kill-switch] toggle failed:", err);
    return adminError("KILL_SWITCH_WRITE_FAILED", "Could not change the kill-switch state", 500);
  }
}
