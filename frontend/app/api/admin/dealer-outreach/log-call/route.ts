// POST /api/admin/dealer-outreach/log-call
//
// THIS ONE SHIPS ENABLED, and it is the point of Phase 3. 1,527 of 1,532
// prospects have a phone number and 167 have an email; the channel that can
// actually reach this list today is a human picking up the phone. Logging that
// call is what turns dealer_outreach_log from an empty table into a record of
// what was tried.
//
// It is deliberately NOT gated on DEALER_OUTREACH_SMS_ENABLED or on the consent
// gate: a manually dialled business number placed by a person is not an
// automated message, and applying the automated-message gate to it would either
// block legitimate work or, worse, teach an operator that the gate is noise.
// DNC is still surfaced in the UI so the operator sees it before dialling.
import { NextRequest } from "next/server";
import { getAdminFromRequest, adminSuccess, adminError, OPERATIONAL_ROLES } from "@/lib/auth/admin-api";
import type { AdminRole } from "@prisma/client";
import {
  logDealerCall,
  CALL_DISPOSITIONS,
  type CallDisposition,
  type CallLogError,
} from "@/lib/services/dealer-recruitment/dealer-call-log.service";
import { transitionProspect } from "@/lib/services/dealer-recruitment/dealer-prospect-status.service";
import type { DealerProspectStatus } from "@prisma/client";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS: Record<CallLogError, { status: number; code: string }> = {
  NOT_FOUND: { status: 404, code: "NOT_FOUND" },
  INVALID_DISPOSITION: { status: 400, code: "INVALID_DISPOSITION" },
  INVALID_DURATION: { status: 400, code: "INVALID_DURATION" },
};

interface Body {
  prospectId?: string;
  disposition?: string;
  durationSeconds?: number;
  notes?: string;
}

export async function POST(request: NextRequest) {
  // One session lookup, two outcomes. getAdminWithRole re-runs
  // getAdminFromRequest internally, so calling both cost an extra database
  // round trip per request and returned null for BOTH failure modes.
  const admin = await getAdminFromRequest(request);
  if (!admin) return adminError("UNAUTHORIZED", "Not authenticated", 401);
  if (!OPERATIONAL_ROLES.includes(admin.role as AdminRole)) {
    return adminError("FORBIDDEN", "This role cannot log dealer outreach", 403);
  }

  let payload: Body;
  try {
    payload = (await request.json()) as Body;
  } catch {
    return adminError("INVALID_JSON", "Invalid JSON body", 400);
  }

  if (!payload.prospectId) return adminError("MISSING_ID", "prospectId is required", 400);

  const result = await logDealerCall(
    {
      prospectId: payload.prospectId,
      disposition: payload.disposition as CallDisposition,
      durationSeconds: payload.durationSeconds ?? 0,
      notes: payload.notes,
      actorId: admin.adminId,
    },
    {
      // A connected call advances the prospect; the status machine decides
      // whether that move is legal, and a refusal there must not lose the call
      // record. Best-effort by design — the log row is the deliverable.
      advanceStatus: async (prospectId, to, from) => {
        const moved = await transitionProspect({
          prospectId,
          to: to as DealerProspectStatus,
          actorId: admin.adminId,
        });
        return moved.ok && moved.from === from;
      },
    },
  );

  if (!result.ok) {
    const mapped = STATUS[result.error ?? "NOT_FOUND"];
    const detail =
      result.error === "INVALID_DISPOSITION"
        ? `disposition must be one of: ${CALL_DISPOSITIONS.join(", ")}`
        : result.error === "INVALID_DURATION"
          ? "durationSeconds must be a non-negative number"
          : "Dealer prospect not found";
    return adminError(mapped.code, detail, mapped.status);
  }
  return adminSuccess(result);
}
