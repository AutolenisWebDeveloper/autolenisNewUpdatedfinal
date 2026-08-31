// POST /api/admin/dealer-outreach/status — move a prospect through the funnel.
//
// The rules are the SERVER'S. A disabled option in a dropdown proves nothing;
// anyone with a session can POST. Legality, the mandatory dead reason and the
// concurrency guard all live in the service, and this route only maps their
// structured reasons onto status codes.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import type { AdminRole } from "@prisma/client";
import {
  transitionProspect,
  TRANSITIONS,
  type TransitionError,
} from "@/lib/services/dealer-recruitment/dealer-prospect-status.service";
import type { DealerProspectStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<TransitionError, { status: number; code: string }> = {
  NOT_FOUND: { status: 404, code: "NOT_FOUND" },
  // A missing reason is a fixable input problem, so 400. An illegal or raced
  // move is a state conflict the caller cannot fix by editing the body.
  DEAD_REASON_REQUIRED: { status: 400, code: "DEAD_REASON_REQUIRED" },
  ILLEGAL_TRANSITION: { status: 409, code: "ILLEGAL_TRANSITION" },
  CONCURRENT_TRANSITION: { status: 409, code: "CONCURRENT_TRANSITION" },
};

interface Body {
  prospectId?: string;
  to?: string;
  deadReason?: string;
}

export async function POST(request: NextRequest) {
  // One session lookup, two outcomes. getAdminWithRole re-runs
  // getAdminFromRequest internally, so calling both cost an extra database
  // round trip per request and returned null for BOTH failure modes.
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!OPERATIONAL_ROLES.includes(admin.role as AdminRole)) {
    return adminError("FORBIDDEN", "This role cannot change prospect status", 403);
  }

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400);
  }

  if (!payload.prospectId) return adminError("MISSING_ID", "prospectId is required", 400);

  // Validate the target against the machine's own vocabulary rather than a
  // second hand-maintained list — an unknown value must never reach the service
  // and be silently treated as a legal-looking string.
  const known = Object.keys(TRANSITIONS);
  if (!payload.to || !known.includes(payload.to)) {
    return adminError("INVALID_STATUS", `to must be one of: ${known.join(", ")}`, 400);
  }

  const result = await transitionProspect({
    prospectId: payload.prospectId,
    to: payload.to as DealerProspectStatus,
    deadReason: payload.deadReason,
    actorId: admin.adminId,
  });

  if (!result.ok) {
    const mapped = STATUS[result.error ?? "NOT_FOUND"];
    return adminError(mapped.code, `Transition refused: ${result.error}`, mapped.status);
  }
  return adminSuccess(result);
}
